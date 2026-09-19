import { describe, expect, it, vi } from 'vitest';
import { fetchUpstreamModelIds, isHttpUrl, modelsEndpoint, parseModelIds, probeApi } from './apiProbe';

const response = (status: number, body?: unknown) =>
  ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  }) as Response;

describe('modelsEndpoint', () => {
  it('已经有版本段就接 /models，否则补 /v1', () => {
    expect(modelsEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/models');
    expect(modelsEndpoint('https://api.deepseek.com/v1')).toBe('https://api.deepseek.com/v1/models');
    expect(modelsEndpoint('https://x.example/v1beta')).toBe('https://x.example/v1beta/models');
    expect(modelsEndpoint('https://x.example/v1/')).toBe('https://x.example/v1/models');
  });

  it('已经是 /models 就不重复接', () => {
    expect(modelsEndpoint('https://x.example/v1/models')).toBe('https://x.example/v1/models');
  });
});

describe('parseModelIds', () => {
  it('OpenAI 的 data[].id', () => {
    expect(parseModelIds({ data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b']);
  });

  it('Google 的 models[].name 去掉 models/ 前缀', () => {
    expect(parseModelIds({ models: [{ name: 'models/gemini-3.8-flash' }] })).toEqual([
      'gemini-3.8-flash',
    ]);
  });

  it('结构对不上返回 null（拿不到列表，而不是空列表）', () => {
    expect(parseModelIds(null)).toBeNull();
    expect(parseModelIds({ 没有: '列表' })).toBeNull();
  });
});

describe('probeApi', () => {
  const input = { modelId: 'deepseek-flash', baseUrl: 'https://relay.example/v1', api: 'openai-completions', key: 'sk-1' };

  it('模型在列表里：通、模型在列，并带上耗时', async () => {
    const fetchLike = vi.fn(async () => response(200, { data: [{ id: 'deepseek-flash' }] }));

    const result = await probeApi(input, { fetchLike });

    expect(result).toMatchObject({ ok: true, status: 200, modelFound: true, keyUsed: true });
    expect(typeof result.ms).toBe('number');
  });

  it('列表里没这个模型：通，但 modelFound 为 false', async () => {
    const fetchLike = vi.fn(async () => response(200, { data: [{ id: '别的模型' }] }));

    await expect(probeApi(input, { fetchLike })).resolves.toMatchObject({
      ok: true,
      modelFound: false,
    });
  });

  it('401 判为鉴权失败', async () => {
    const fetchLike = vi.fn(async () => response(401));

    await expect(probeApi(input, { fetchLike })).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    expect((await probeApi(input, { fetchLike })).error).toContain('鉴权失败');
  });

  it('端点不提供模型列表（404）不算不通，只是没法核对模型', async () => {
    const fetchLike = vi.fn(async () => response(404));

    await expect(probeApi(input, { fetchLike })).resolves.toMatchObject({
      ok: true,
      status: 404,
      modelFound: null,
    });
  });

  it('连不上时把原因带回来', async () => {
    const fetchLike = vi.fn(async () => {
      throw new Error('fetch failed: ENOTFOUND');
    });

    const result = await probeApi(input, { fetchLike });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('ENOTFOUND');
  });

  it('anthropic 走 x-api-key，没有密钥时就只测地址', async () => {
    const fetchLike = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-a');
      expect(headers.Authorization).toBeUndefined();
      return response(200, { data: [] });
    });

    await probeApi({ ...input, api: 'anthropic-messages', key: 'sk-a' }, { fetchLike });

    const noKey = vi.fn(async () => response(200, { data: [] }));
    await expect(probeApi({ ...input, key: null }, { fetchLike: noKey })).resolves.toMatchObject({
      keyUsed: false,
    });
  });

  it('google 把密钥放在查询参数里', async () => {
    const fetchLike = vi.fn(async (url: string) => {
      expect(url).toContain('key=sk-g');
      return response(200, { models: [] });
    });

    await probeApi({ ...input, api: 'google-generative-ai', key: 'sk-g' }, { fetchLike });
  });
});

describe('isHttpUrl', () => {
  it('只认 http / https', () => {
    expect(isHttpUrl('https://api.example.com/v1')).toBe(true);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
  });
});

describe('fetchUpstreamModelIds', () => {
  it('拿到上游自己报的清单', async () => {
    const fetchLike = vi.fn(async (_url: string, _init?: RequestInit) =>
      response(200, { data: [{ id: 'deepseek-v4-flash' }, { id: 'glm-5.3' }] })
    );

    await expect(
      fetchUpstreamModelIds('https://relay.example/v1', 'sk-1', { fetchLike })
    ).resolves.toEqual(['deepseek-v4-flash', 'glm-5.3']);

    // 地址补成 /v1/models，密钥走 Authorization
    expect(fetchLike.mock.calls[0][0]).toBe('https://relay.example/v1/models');
    expect((fetchLike.mock.calls[0][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer sk-1',
    });
  });

  it('地址写错（200 但空响应体）拿不到清单 → null', async () => {
    // 真实案例：中转站的分组前缀 /1 下所有请求都回 200 空响应
    const fetchLike = vi.fn(async () => response(200, null));

    await expect(
      fetchUpstreamModelIds('https://relay.example/1', 'sk-1', { fetchLike })
    ).resolves.toBeNull();
  });

  it('鉴权失败 / 网络错 / 超时都不抛，一律 null（调用方退回复制内置目录）', async () => {
    await expect(
      fetchUpstreamModelIds('https://r/v1', 'sk', { fetchLike: vi.fn(async () => response(401)) })
    ).resolves.toBeNull();
    await expect(
      fetchUpstreamModelIds('https://r/v1', 'sk', {
        fetchLike: vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      })
    ).resolves.toBeNull();
  });

  it('没有密钥时不带 Authorization（仍能拿到公开清单）', async () => {
    const fetchLike = vi.fn(async (_url: string, _init?: RequestInit) =>
      response(200, { data: [{ id: 'a' }] })
    );

    await fetchUpstreamModelIds('https://r/v1', '', { fetchLike });

    expect((fetchLike.mock.calls[0][1] as RequestInit).headers).not.toHaveProperty(
      'Authorization'
    );
  });
});
