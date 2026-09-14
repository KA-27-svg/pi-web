import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import { listSessions, readSessionCwdSync, renameSession } from './sessions.js';
import {
  emptyTrash,
  listTrash,
  purgeSession,
  restoreSession,
  sweepTrash,
  trashSession,
} from './trash.js';

const PORT = 3001;
// 桥接能以任意 cwd 拉起 `pi --mode rpc`，等同于把本机命令执行能力开放出去，
// 因此默认只监听回环地址，确有跨设备需求时再用环境变量显式放开。
const HOST = process.env.PI_BRIDGE_HOST || '127.0.0.1';
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', name: 'pi-web-bridge' }));
});

const wss = new WebSocketServer({ server });

let piProcess: ChildProcessWithoutNullStreams | null = null;
let currentCwd = process.cwd();
/**
 * 刚请求切换到的会话的工作目录。
 * pi 的 switch_session 会连带把工作目录换掉，但那个 cwd 只存在会话文件里，
 * RPC 的 get_state 也不返回它，所以桥接自己在转发前读出来，等 pi 确认成功后再应用。
 */
let pendingSwitchCwd: string | null = null;

function broadcast(msg: string) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

/**
 * 统一的「跑一个异步操作 → 回一条结果」封装。
 * payload 用来把操作结果或原请求里的字段带回去。
 */
function reply<T>(
  ws: WebSocket,
  type: string,
  run: () => Promise<T>,
  payload?: (value: T) => Record<string, unknown>
) {
  run()
    .then(value => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type, success: true, ...(payload?.(value) ?? {}) }));
    })
    .catch(err => {
      console.error(`[Pi Bridge] ${type} failed:`, err);
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({ type, success: false, error: String(err?.message ?? err) })
      );
    });
}

/**
 * pi 确认会话切换成功后，把桥接的 currentCwd 一并换掉。
 * 失败或被扩展取消时 pi 的工作目录没变，必须保持原样。
 */
function applyPendingSwitch(line: string) {
  if (!pendingSwitchCwd || !line.includes('switch_session')) return;

  let message: any;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message?.type !== 'response' || message.command !== 'switch_session') return;

  if (!message.success || message.data?.cancelled) {
    pendingSwitchCwd = null;
    return;
  }

  currentCwd = pendingSwitchCwd;
  pendingSwitchCwd = null;
  console.log(`[Pi Bridge] Session switch moved cwd to: ${currentCwd}`);
  broadcast(JSON.stringify({ type: 'cwd_changed', cwd: currentCwd }));
}

function ensurePiRpc(cwd: string) {
  if (piProcess && piProcess.exitCode === null && !piProcess.killed) {
    return;
  }

  console.log(`[Pi Bridge] Spawning pi --mode rpc in: ${cwd}`);
  
  // shell: true 是 Windows 上运行 npm 全局 CLI（pi.cmd）所必需的；
  // 命令行参数是静态字面量，cwd 也只通过 spawn 的 cwd 选项传递，不经过 shell 拼接。
  piProcess = spawn('pi', ['--mode', 'rpc'], {
    cwd,
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  });

  let lineBuffer = '';

  piProcess.stdout.on('data', (chunk: Buffer) => {
    lineBuffer += chunk.toString('utf-8');
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      applyPendingSwitch(trimmed);
      broadcast(trimmed);
    }
  });

  piProcess.stderr.on('data', (chunk: Buffer) => {
    const errText = chunk.toString('utf-8');
    console.error(`[Pi STDERR]: ${errText}`);
    broadcast(JSON.stringify({
      type: 'pi_stderr',
      message: errText,
    }));
  });

  piProcess.on('close', (code) => {
    console.log(`[Pi Bridge] Pi process exited with code ${code}`);
    broadcast(JSON.stringify({
      type: 'pi_process_exit',
      code,
    }));
    piProcess = null;
  });

  piProcess.on('error', (err) => {
    console.error(`[Pi Bridge] Process error:`, err);
    broadcast(JSON.stringify({
      type: 'pi_process_error',
      error: err.message,
    }));
    piProcess = null;
  });
}

function restartPi(cwd: string) {
  if (piProcess) {
    try {
      piProcess.kill();
    } catch {}
    piProcess = null;
  }
  ensurePiRpc(cwd);
}

function sendToPi(jsonCommand: object) {
  // 保证进程可用，不可用时自愈重启
  ensurePiRpc(currentCwd);

  if (!piProcess || !piProcess.stdin.writable) {
    console.warn('[Pi Bridge] Pi process not ready after ensure, cannot send command');
    return false;
  }
  const payload = JSON.stringify(jsonCommand) + '\n';
  piProcess.stdin.write(payload, 'utf-8');
  return true;
}

wss.on('connection', (ws: WebSocket) => {
  console.log('[Pi Bridge] Client connected via WebSocket');

  // 保证 Pi 运行时已拉起
  ensurePiRpc(currentCwd);

  // 发送初始桥接状态
  ws.send(JSON.stringify({
    type: 'bridge_status',
    cwd: currentCwd,
    running: !!piProcess,
  }));

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      // 切换工作目录：只接受真实存在的目录，否则 pi 会以无效 cwd 启动失败
      if (data.type === 'change_cwd') {
        const target = path.resolve(String(data.cwd ?? ''));
        fs.stat(target)
          .then(stat => {
            if (!stat.isDirectory()) throw new Error('not a directory');
            currentCwd = target;
            restartPi(currentCwd);
            broadcast(JSON.stringify({ type: 'cwd_changed', cwd: currentCwd }));
          })
          .catch(err => {
            console.error('[Pi Bridge] Rejected cwd:', target, err?.message ?? err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'bridge_error',
                error: `无法切换工作目录：${target} 不存在或不是目录`,
              }));
            }
          });
        return;
      }

      // 重启 Pi 进程
      if (data.type === 'restart_pi') {
        restartPi(currentCwd);
        return;
      }

      // 历史会话列表：pi 的 RPC 没有列举接口，由桥接扫描会话目录
      if (data.type === 'list_sessions') {
        listSessions()
          .then(({ sessions, total }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'sessions_list', sessions, total }));
            }
          })
          .catch(err => {
            console.error('[Pi Bridge] Failed to list sessions:', err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({ type: 'sessions_list', sessions: [], total: 0, error: String(err?.message ?? err) })
              );
            }
          });
        return;
      }

      // 切换会话：pi 会把工作目录换成会话里记的 cwd，桥接必须跟着换，
      // 否则设置面板显示的是旧目录，pi 崩溃自愈重启也会在错的目录里拉起
      if (data.type === 'switch_session' && typeof data.sessionPath === 'string') {
        pendingSwitchCwd = readSessionCwdSync(data.sessionPath);
        sendToPi(data);
        return;
      }

      // 历史会话的增删改：pi 的 RPC 只认当前会话，这些都得桥接直接操作文件
      if (data.type === 'rename_session') {
        reply(ws, 'session_renamed', () => renameSession(data.sessionPath, String(data.name ?? '').trim()), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      // 删除 = 移入回收箱（保留 30 天），所以可以一步到位、不需要二次确认
      if (data.type === 'trash_session') {
        reply(ws, 'session_trashed', () => trashSession(data.sessionPath), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      if (data.type === 'list_trash') {
        reply(ws, 'trash_list', () => listTrash(), sessions => ({ sessions }));
        return;
      }

      if (data.type === 'restore_session') {
        reply(ws, 'session_restored', () => restoreSession(data.sessionPath), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      if (data.type === 'purge_session') {
        reply(ws, 'session_purged', () => purgeSession(data.sessionPath), () => ({
          sessionPath: data.sessionPath,
        }));
        return;
      }

      if (data.type === 'empty_trash') {
        reply(ws, 'trash_emptied', () => emptyTrash(), removed => ({ removed }));
        return;
      }

      // 转发指令给 Pi (prompt, abort, new_session, get_state, get_messages 等)
      sendToPi(data);
    } catch (err: any) {
      console.error('[Pi Bridge] Error handling client message:', err);
      ws.send(JSON.stringify({
        type: 'bridge_error',
        error: err.message,
      }));
    }
  });

  ws.on('close', () => {
    console.log('[Pi Bridge] Client disconnected');
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[Pi Bridge] Server listening on http://${HOST}:${PORT}`);
  console.log(`[Pi Bridge] WebSocket ready on ws://${HOST}:${PORT}`);

  // 桥接不常驻，所以靠启动时扫一次来执行回收箱的 30 天保留期
  sweepTrash()
    .then(removed => {
      if (removed > 0) console.log(`[Pi Bridge] Swept ${removed} expired trashed session(s)`);
    })
    .catch(err => console.error('[Pi Bridge] Trash sweep failed:', err));
});
