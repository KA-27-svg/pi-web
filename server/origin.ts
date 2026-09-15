import type { Server } from 'http';
import type { WebSocketServer } from 'ws';

/** 前端默认端口：`vite` 是 5173，`vite preview` 是 4173 */
const DEFAULT_CLIENT_PORTS = [5173, 4173];

/**
 * 允许的前端来源。
 *
 * 桥接能把任意 prompt 送进 `pi`（它有完整的工具执行权限），而 WebSocket 不受同源策略约束：
 * 少了这道校验，用户只要在浏览器里打开一个恶意页面，那个页面就能连上
 * ws://127.0.0.1:3001 让本机执行任意命令（CSWSH）。所以按 Origin 白名单放行。
 *
 * 用 `PI_BRIDGE_ORIGINS`（逗号分隔）覆盖，例如监听局域网时把自己的来源加进去。
 */
export function parseAllowedOrigins(
  env: Record<string, string | undefined> = process.env,
  bridgePort = 3001
): Set<string> {
  const custom = env.PI_BRIDGE_ORIGINS?.trim();
  if (custom) {
    return new Set(
      custom
        .split(',')
        .map(origin => origin.trim().toLowerCase())
        .filter(Boolean)
    );
  }

  const origins = new Set<string>();
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const port of [...DEFAULT_CLIENT_PORTS, bridgePort]) {
      origins.add(`http://${host}:${port}`);
    }
  }
  return origins;
}

/**
 * 没有 Origin 的一律放行：脚本 / CLI 客户端本来就不带它，而这正是本地工具的正常用法。
 * 浏览器一定会带 Origin，所以 CSWSH 依然被挡住。
 */
export function isAllowedOrigin(origin: string | undefined, allowed: Set<string>): boolean {
  if (!origin) return true;
  return allowed.has(origin.trim().toLowerCase());
}

/** 在握手阶段拦掉陌生来源，不合格的连接直接拿不到 WebSocket */
export function attachOriginGuard(
  server: Server,
  wss: WebSocketServer,
  allowed: Set<string>
): void {
  server.on('upgrade', (req, socket, head) => {
    if (!isAllowedOrigin(req.headers.origin, allowed)) {
      console.warn(`[Pi Bridge] Rejected WebSocket upgrade from origin: ${req.headers.origin}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
}
