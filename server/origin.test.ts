import * as http from 'http';
import type { AddressInfo } from 'net';
import { WebSocket, WebSocketServer } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import { attachOriginGuard, isAllowedOrigin, parseAllowedOrigins } from './origin';

describe('parseAllowedOrigins', () => {
  it('默认放行本地开发与预览端口', () => {
    const allowed = parseAllowedOrigins({}, 3001);

    expect(allowed.has('http://localhost:5173')).toBe(true);
    expect(allowed.has('http://127.0.0.1:5173')).toBe(true);
    expect(allowed.has('http://127.0.0.1:4173')).toBe(true);
    expect(allowed.has('http://127.0.0.1:3001')).toBe(true);
  });

  it('可以用环境变量覆盖', () => {
    const allowed = parseAllowedOrigins({ PI_BRIDGE_ORIGINS: 'http://10.0.0.5:5173, http://box:8080' }, 3001);

    expect(allowed.has('http://10.0.0.5:5173')).toBe(true);
    expect(allowed.has('http://box:8080')).toBe(true);
    expect(allowed.has('http://localhost:5173')).toBe(false);
  });
});

describe('isAllowedOrigin', () => {
  const allowed = new Set(['http://localhost:5173']);

  it('白名单内的来源放行', () => {
    expect(isAllowedOrigin('http://localhost:5173', allowed)).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(isAllowedOrigin('HTTP://LOCALHOST:5173', allowed)).toBe(true);
  });

  it('陌生来源拒绝', () => {
    // 恶意页面正是靠这一点被挡住：没有它，任何网页都能连上桥接执行命令
    expect(isAllowedOrigin('http://evil.example', allowed)).toBe(false);
    expect(isAllowedOrigin('http://localhost:8080', allowed)).toBe(false);
  });

  it('没有 Origin 的放行（脚本 / CLI 客户端）', () => {
    expect(isAllowedOrigin(undefined, allowed)).toBe(true);
  });
});

/** 真实起一个 http server + ws，验证升级握手确实被拦下 */
async function startServer() {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });
  attachOriginGuard(server, wss, parseAllowedOrigins({}, 3001));

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const url = `ws://127.0.0.1:${port}`;

  return {
    url,
    async close() {
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

describe('WebSocket 升级握手', () => {
  let running: Awaited<ReturnType<typeof startServer>> | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  it('白名单来源可以建立连接', async () => {
    running = await startServer();
    const ws = new WebSocket(running.url, { headers: { origin: 'http://localhost:5173' } });

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });

    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.terminate();
  });

  it('陌生来源在握手阶段就被 403 拒绝，连接不会建立', async () => {
    running = await startServer();
    const ws = new WebSocket(running.url, { headers: { origin: 'http://evil.example' } });

    const status = await new Promise<number | undefined>((resolve, reject) => {
      ws.once('unexpected-response', (_req, response) => resolve(response.statusCode));
      ws.once('open', () => reject(new Error('陌生来源不应该连上')));
      ws.once('error', () => resolve(undefined));
    });

    expect(status).toBe(403);
  });
});
