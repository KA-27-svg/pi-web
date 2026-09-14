import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs/promises';
import { listSessions, renameSession, deleteSession } from './sessions.js';

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

function broadcast(msg: string) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
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
          .then(sessions => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'sessions_list', sessions }));
            }
          })
          .catch(err => {
            console.error('[Pi Bridge] Failed to list sessions:', err);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({ type: 'sessions_list', sessions: [], error: String(err?.message ?? err) })
              );
            }
          });
        return;
      }

      // 重命名 / 删除历史会话（pi 的 RPC 不提供对任意会话的这两个操作）
      if (data.type === 'rename_session') {
        renameSession(data.sessionPath, String(data.name ?? '').trim())
          .then(() =>
            ws.send(
              JSON.stringify({ type: 'session_renamed', success: true, sessionPath: data.sessionPath })
            )
          )
          .catch(err =>
            ws.send(
              JSON.stringify({
                type: 'session_renamed',
                success: false,
                sessionPath: data.sessionPath,
                error: String(err?.message ?? err),
              })
            )
          );
        return;
      }

      if (data.type === 'delete_session') {
        deleteSession(data.sessionPath)
          .then(() =>
            ws.send(
              JSON.stringify({ type: 'session_deleted', success: true, sessionPath: data.sessionPath })
            )
          )
          .catch(err =>
            ws.send(
              JSON.stringify({
                type: 'session_deleted',
                success: false,
                sessionPath: data.sessionPath,
                error: String(err?.message ?? err),
              })
            )
          );
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
});
