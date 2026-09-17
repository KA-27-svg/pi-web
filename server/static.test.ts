import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { contentTypeFor, createStaticHandler, resolveFileWithin } from './static';

describe('contentTypeFor', () => {
  it('认得前端会用到的类型', () => {
    expect(contentTypeFor('/a/index.html')).toContain('text/html');
    expect(contentTypeFor('/a/index-abc.js')).toContain('text/javascript');
    expect(contentTypeFor('/a/index-abc.css')).toContain('text/css');
    expect(contentTypeFor('/a/pi-web.ico')).toBe('image/x-icon');
    expect(contentTypeFor('/a/font.woff2')).toBe('font/woff2');
  });

  it('大小写不敏感', () => {
    expect(contentTypeFor('/a/INDEX.HTML')).toContain('text/html');
  });

  it('认不出来时不猜，给通用的二进制类型', () => {
    expect(contentTypeFor('/a/thing.xyz')).toBe('application/octet-stream');
    expect(contentTypeFor('/a/没有扩展名')).toBe('application/octet-stream');
  });
});

describe('resolveFileWithin', () => {
  const root = path.resolve('/srv/dist');

  it('正常路径解析到 root 内', () => {
    expect(resolveFileWithin(root, '/assets/a.js')).toBe(path.join(root, 'assets', 'a.js'));
    expect(resolveFileWithin(root, '')).toBe(root);
  });

  it('挡掉 ../ 穿越', () => {
    // 这个服务对回环地址开放，但没理由让它能读任意文件
    expect(resolveFileWithin(root, '/../../etc/passwd')).toBeNull();
    expect(resolveFileWithin(root, '/assets/../../secret.txt')).toBeNull();
    expect(resolveFileWithin(root, '../secret')).toBeNull();
  });

  it('挡掉 NUL 字节', () => {
    expect(resolveFileWithin(root, '/a\0b')).toBeNull();
  });

  it('同一目录下的相似前缀不算越界', () => {
    // /srv/dist-other 不能因为前缀相同就被放行
    expect(resolveFileWithin(root, '/../dist-other/x')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-dist-'));
  await fs.mkdir(path.join(dir, 'assets'), { recursive: true });
  await fs.writeFile(path.join(dir, 'index.html'), '<!doctype html><title>pi</title>');
  await fs.writeFile(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)');
  await fs.writeFile(path.join(path.dirname(dir), 'secret.txt'), '不该被读到');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(path.join(path.dirname(dir), 'secret.txt'), { force: true });
});

interface Captured {
  handled: boolean;
  status: number;
  headers: Record<string, any>;
  body: string;
}

async function request(url: string, method = 'GET'): Promise<Captured> {
  const handler = createStaticHandler({ root: dir });
  let status = 0;
  let headers: Record<string, any> = {};
  const chunks: Buffer[] = [];

  const res = {
    writeHead(code: number, next?: Record<string, any>) {
      status = code;
      headers = next ?? {};
      return res;
    },
    end(chunk?: unknown) {
      if (chunk) chunks.push(Buffer.from(chunk as Buffer));
      return res;
    },
  } as unknown as ServerResponse;

  const handled = await handler({ method, url } as IncomingMessage, res);
  return { handled, status, headers, body: Buffer.concat(chunks).toString('utf-8') };
}

describe('createStaticHandler', () => {
  it('根路径给 index.html', async () => {
    const result = await request('/');

    expect(result.handled).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toContain('<title>pi</title>');
    expect(result.headers['Content-Type']).toContain('text/html');
  });

  it('index.html 不缓存，否则前端更新后用户会一直看到旧页面', async () => {
    const result = await request('/');
    expect(result.headers['Cache-Control']).toBe('no-cache');
  });

  it('assets 下的带哈希文件长缓存', async () => {
    const result = await request('/assets/index-abc123.js');

    expect(result.body).toBe('console.log(1)');
    expect(result.headers['Content-Type']).toContain('text/javascript');
    expect(result.headers['Cache-Control']).toContain('immutable');
  });

  it('前端路由回落到 index.html（SPA）', async () => {
    const result = await request('/some/deep/route');

    expect(result.handled).toBe(true);
    expect(result.body).toContain('<title>pi</title>');
  });

  it('丢掉的静态资源不回落，老实交给上层报 404', async () => {
    // 回落成 HTML 会让浏览器把一段 HTML 当 JS 解析，报错更难懂
    const result = await request('/assets/missing.js');

    expect(result.handled).toBe(false);
  });

  it('穿越尝试读不到目录外的文件', async () => {
    const result = await request('/../secret.txt');

    expect(result.body).not.toContain('不该被读到');
  });

  it('HEAD 只回头不回正文', async () => {
    const result = await request('/', 'HEAD');

    expect(result.status).toBe(200);
    expect(result.body).toBe('');
  });

  it('非 GET / HEAD 不接', async () => {
    const result = await request('/', 'POST');
    expect(result.handled).toBe(false);
  });

  it('压过超链接编码的穿越同样挡住', async () => {
    const result = await request('/%2e%2e/secret.txt');

    expect(result.body).not.toContain('不该被读到');
  });

  it('畸形的百分号编码不抛错，交给上层报 404', async () => {
    // decodeURIComponent('%zz') 会抛 URIError；让它冒出去会变成 500
    const result = await request('/%zz');

    expect(result.handled).toBe(false);
  });
});
