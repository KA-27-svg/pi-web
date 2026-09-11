import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import * as path from 'path';

const PORT = 3001;
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
