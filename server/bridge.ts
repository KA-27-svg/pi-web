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

function startPiRpc(cwd: string, onEvent: (data: string) => void) {
  if (piProcess) {
    try {
      piProcess.kill();
    } catch {}
    piProcess = null;
  }

  console.log(`[Pi Bridge] Spawning pi --mode rpc in: ${cwd}`);
  
  // Windows 下通过 shell 启动 pi --mode rpc
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
      onEvent(trimmed);
    }
  });

  piProcess.stderr.on('data', (chunk: Buffer) => {
    const errText = chunk.toString('utf-8');
    console.error(`[Pi STDERR]: ${errText}`);
    onEvent(JSON.stringify({
      type: 'pi_stderr',
      message: errText,
    }));
  });

  piProcess.on('close', (code) => {
    console.log(`[Pi Bridge] Pi process exited with code ${code}`);
    onEvent(JSON.stringify({
      type: 'pi_process_exit',
      code,
    }));
    piProcess = null;
  });

  piProcess.on('error', (err) => {
    console.error(`[Pi Bridge] Process error:`, err);
    onEvent(JSON.stringify({
      type: 'pi_process_error',
      error: err.message,
    }));
  });
}

function sendToPi(jsonCommand: object) {
  if (!piProcess || !piProcess.stdin.writable) {
    console.warn('[Pi Bridge] Pi process not ready, cannot send command');
    return false;
  }
  const payload = JSON.stringify(jsonCommand) + '\n';
  piProcess.stdin.write(payload, 'utf-8');
  return true;
}

wss.on('connection', (ws: WebSocket) => {
  console.log('[Pi Bridge] Client connected via WebSocket');

  // 当客户端连接时，广播当前状态
  ws.send(JSON.stringify({
    type: 'bridge_status',
    cwd: currentCwd,
    running: !!piProcess,
  }));

  // 如果尚未启动 pi 子进程，则启动一个
  if (!piProcess) {
    startPiRpc(currentCwd, (eventJsonLine) => {
      // 广播给所有连接的客户端
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(eventJsonLine);
        }
      });
    });
  }

  ws.on('message', (message: string) => {
    try {
      const data = JSON.parse(message.toString());

      // 客户端发来的控制指令
      if (data.type === 'change_cwd') {
        const targetDir = data.cwd || process.cwd();
        currentCwd = path.resolve(targetDir);
        startPiRpc(currentCwd, (eventJsonLine) => {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(eventJsonLine);
            }
          });
        });
        ws.send(JSON.stringify({ type: 'cwd_changed', cwd: currentCwd }));
        return;
      }

      if (data.type === 'restart_pi') {
        startPiRpc(currentCwd, (eventJsonLine) => {
          wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(eventJsonLine);
            }
          });
        });
        return;
      }

      // 其余直接转发给 Pi 的 stdin (prompt, abort, bash, etc.)
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
