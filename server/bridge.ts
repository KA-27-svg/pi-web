import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';

const PORT = 3001;
const SESSIONS_ROOT = path.join(os.homedir(), '.pi', 'agent', 'sessions');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
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

/** 只允许操作会话目录内的文件，避免路径穿越 */
function resolveSessionPath(sessionPath: string): string {
  const root = path.resolve(SESSIONS_ROOT) + path.sep;
  const resolved = path.resolve(sessionPath);
  if (!resolved.startsWith(root) || !resolved.endsWith('.jsonl')) {
    throw new Error('invalid session path');
  }
  return resolved;
}

function randomEntryId(): string {
  return Math.random().toString(16).slice(2, 10);
}

/**
 * 重命名历史会话：pi 只能给当前会话改名的 set_session_name，
 * 因此沿用它的存储方式，在 JSONL 末尾追加一条 session_info，
 * parentId 指向最后一条 entry 以保证树链完整。
 */
async function renameSession(sessionPath: string, name: string): Promise<void> {
  const target = resolveSessionPath(sessionPath);
  const raw = await fs.readFile(target, 'utf-8');

  let parentId: string | null = null;
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line || line.charCodeAt(0) !== 123) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.id === 'string') {
        parentId = entry.id;
        break;
      }
    } catch {
      // 忽略无法解析的行
    }
  }

  const entry = {
    type: 'session_info',
    id: randomEntryId(),
    parentId,
    timestamp: new Date().toISOString(),
    name,
  };
  const prefix = raw.length === 0 || raw.endsWith('\n') ? '' : '\n';
  await fs.appendFile(target, `${prefix}${JSON.stringify(entry)}\n`, 'utf-8');
}

async function deleteSession(sessionPath: string): Promise<void> {
  await fs.unlink(resolveSessionPath(sessionPath));
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

interface SessionSummary {
  path: string;
  id: string;
  name?: string;
  preview: string;
  turns: number;
  updatedAt: number;
  cwd?: string;
}

/**
 * 只解析需要的行：会话头取 id、session_info 取名、user 消息计数并取首条作标题。
 * 避免对每条 toolResult 做完整 JSON.parse。
 */
async function readSessionSummary(
  file: string,
  mtimeMs: number
): Promise<SessionSummary> {
  const raw = await fs.readFile(file, 'utf-8');

  let id = '';
  let cwd: string | undefined;
  let name: string | undefined;
  let preview = '';
  let turns = 0;

  for (const line of raw.split('\n')) {
    if (line.charCodeAt(0) !== 123 /* { */) continue;

    if (!id && line.startsWith('{"type":"session"')) {
      try {
        const header = JSON.parse(line);
        id = header.id ?? '';
        cwd = header.cwd || undefined;
      } catch {}
      continue;
    }

    // 重命名会追加新的 session_info，所以取最后一个生效
    if (line.startsWith('{"type":"session_info"')) {
      try {
        name = JSON.parse(line).name || undefined;
      } catch {}
      continue;
    }
    if (line.startsWith('{"type":"message"') && line.includes('"role":"user"')) {
      let entry: any;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry?.message?.role !== 'user') continue;
      turns += 1;
      if (!preview) {
        const content = entry.message.content;
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((c: any) => c?.text || '').join(' ')
              : '';
        const clean = text.replace(/\s+/g, ' ').trim();
        // 跳过 skill 注入这类以尖括号开头的系统内容
        if (clean && !clean.startsWith('<')) preview = clean;
      }
    }
  }

  return {
    path: file,
    id: id || path.basename(file).replace(/^[^_]*_/, '').replace(/\.jsonl$/, ''),
    name,
    preview: preview.slice(0, 90),
    turns,
    updatedAt: mtimeMs,
    cwd,
  };
}

/**
 * 会话按工作目录分目录存放。侧栏像 Codex 一样展示全部历史，
 * 因此扫全部子目录后按修改时间取最近的若干条。
 */
async function listSessions(limit = 60): Promise<SessionSummary[]> {
  let dirs: string[];
  try {
    const entries = await fs.readdir(SESSIONS_ROOT, { withFileTypes: true });
    dirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(SESSIONS_ROOT, entry.name));
  } catch {
    return [];
  }

  const candidates: { full: string; mtimeMs: number }[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(dir, name);
      try {
        const stat = await fs.stat(full);
        candidates.push({ full, mtimeMs: stat.mtimeMs });
      } catch {
        // 忽略无法 stat 的文件
      }
    }
  }

  const recent = candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  const summaries: SessionSummary[] = [];
  for (const file of recent) {
    try {
      summaries.push(await readSessionSummary(file.full, file.mtimeMs));
    } catch {
      // 跳过损坏或不可读的会话
    }
  }
  return summaries;
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

      // 切换工作目录
      if (data.type === 'change_cwd') {
        const targetDir = data.cwd || process.cwd();
        currentCwd = path.resolve(targetDir);
        restartPi(currentCwd);
        broadcast(JSON.stringify({ type: 'cwd_changed', cwd: currentCwd }));
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

server.listen(PORT, () => {
  console.log(`[Pi Bridge] Server listening on http://localhost:${PORT}`);
  console.log(`[Pi Bridge] WebSocket ready on ws://localhost:${PORT}`);
});
