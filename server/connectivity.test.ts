import { describe, expect, it, vi } from 'vitest';
import { checkTargets, checkUrl, isHttpUrl } from './connectivity';

const response = (status: number) => ({ status } as Response);

describe('isHttpUrl', () => {
  it('只认 http / https', () => {
    expect(isHttpUrl('https://api.example.com/v1')).toBe(true);
    expect(isHttpUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isHttpUrl('ftp://x')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('随便写的')).toBe(false);
  });
});

describe('checkUrl', () => {
  it('服务端回了任何 HTTP 状态都算通（401 / 404 也算）', async () => {
    const fetchLike = vi.fn(async () => response(401));

    await expect(checkUrl('https://api.example.com/v1', { fetchLike })).resolves.toEqual({
      url: 'https://api.example.com/v1',
      ok: true,
      status: 401,
    });
  });

  it('连不上时把原因带回来', async () => {
    const fetchLike = vi.fn(async () => {
      throw new Error('fetch failed: ENOTFOUND');
    });

    const result = await checkUrl('https://nope.example.com', { fetchLike });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });

  it('超时按超时说明，不把 AbortError 原样丢出去', async () => {
    const fetchLike = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('AbortError')));
        })
    );

    const result = await checkUrl('https://slow.example.com', { fetchLike, timeoutMs: 10 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('超时');
  });
});

describe('checkTargets', () => {
  it('逐个带上 id，非法地址直接算不通、不发请求', async () => {
    const fetchLike = vi.fn(async () => response(200));

    const results = await checkTargets(
      [
        { id: 'npm', url: 'https://registry.npmjs.org/' },
        { id: 'bad', url: 'file:///etc/passwd' },
      ],
      { fetchLike }
    );

    expect(results).toEqual([
      { id: 'npm', url: 'https://registry.npmjs.org/', ok: true, status: 200 },
      { id: 'bad', url: 'file:///etc/passwd', ok: false, error: '地址不是 http/https' },
    ]);
    expect(fetchLike).toHaveBeenCalledTimes(1);
  });
});
