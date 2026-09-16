import * as fs from 'fs/promises';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';

/**
 * 把构建好的前端交给桥接托管。
 *
 * 在这之前，生产模式要同时跑 Vite 和桥接两个进程、占两个端口。托管之后只剩
 * 一条命令、一个端口——而且 `server/origin.ts` 的白名单本来就已经放行
 * `http://127.0.0.1:3001`，所以从桥接端口访问前端不用动安全策略。
 */

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] ?? 'application/octet-stream';
}

/**
 * 把 URL 路径解析成 root 之内的真实文件路径；越界返回 null。
 *
 * `..` 与绝对路径都必须挡住——这个服务对回环地址开放，但没理由让它变成一个
 * 能读任意文件的接口。
 */
export function resolveFileWithin(root: string, urlPath: string): string | null {
  if (urlPath.includes('\0')) return null;

  const base = path.resolve(root);
  const resolved = path.resolve(base, urlPath.replace(/^\/+/, ''));

  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null;
  return resolved;
}

/** Vite 产出的文件名带内容哈希，可以长缓存；其余一律不缓存 */
function isImmutable(filePath: string): boolean {
  return filePath.includes(`${path.sep}assets${path.sep}`);
}

/** 请求路径是否像前端路由（没有扩展名），决定要不要回落到 index.html */
function looksLikeRoute(urlPath: string): boolean {
  return path.extname(urlPath) === '';
}

export interface StaticHandler {
  /** 处理了返回 true；没处理（不是静态资源）返回 false，交给调用方兜底 */
  (req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

export interface StaticHandlerOptions {
  root: string;
  index?: string;
}

export function createStaticHandler({ root, index = 'index.html' }: StaticHandlerOptions): StaticHandler {
  const indexPath = path.resolve(root, index);

  const readFileOrNull = async (filePath: string): Promise<Buffer | null> => {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) return null;
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  };

  const send = (res: ServerResponse, filePath: string, body: Buffer, headOnly: boolean) => {
    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': body.byteLength,
      'Cache-Control': isImmutable(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(headOnly ? undefined : body);
  };

  return async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return false;
    const headOnly = req.method === 'HEAD';

    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
    const candidate = resolveFileWithin(root, urlPath);

    if (candidate) {
      const body = await readFileOrNull(candidate);
      if (body) {
        send(res, candidate, body, headOnly);
        return true;
      }
    }

    // 没扩展名的路径当作前端路由，回落到 index.html（SPA）。
    // 带扩展名却没找到的（比如丢了的 assets/*.js）不回落，让上层老实报 404。
    if (looksLikeRoute(urlPath)) {
      const body = await readFileOrNull(indexPath);
      if (body) {
        send(res, indexPath, body, headOnly);
        return true;
      }
    }

    return false;
  };
}
