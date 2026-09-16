import { describe, expect, it, vi } from 'vitest';
import {
  fetchProviderModels,
  modelsEndpoint,
  normalizeBaseUrl,
  parseModelIds,
  SUPPORTED_APIS,
  type FetchLike,
} from './customProvider';

describe('normalizeBaseUrl', () => {
  it('去掉首尾空白与结尾多余的斜杠', () => {
    expect(normalizeBaseUrl('  https://api.deepseek.com/v1/  ')).toBe(
      'https://api.deepseek.com/v1'
    );
  });

  it('只接受 http 与 https', () => {
    // 否则这里就成了一个能读本地文件的接口
    expect(() => normalizeBaseUrl('file:///etc/passwd')).toThrow(/http/);
    expect(() => normalizeBaseUrl('ftp://x')).toThrow(/http/);
  });

  it('不是合法 URL 时给可读错误', () => {
    expect(() => normalizeBaseUrl('随便写的')).toThrow();
    expect(() => normalizeBaseUrl('')).toThrow();
  });

  it('保留 http（本地推理服务常用）', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
  });
});

describe('modelsEndpoint', () => {
  it('裸域名补 /v1/models', () => {
    // 大多数中转站两种写法都贴得出来，得都照顾到
    expect(modelsEndpoint('https://api.deepseek.com')).toBe('https://api.deepseek.com/v1/models');
  });

  it('已经带版本段就直接接 /models', () => {
    expect(modelsEndpoint('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/v1/models'
    );
    expect(modelsEndpoint('https://x.example/v2')).toBe('https://x.example/v2/models');
  });

  it('已经指向 /models 就不重复拼', () => {
    expect(modelsEndpoint('https://x.example/v1/models')).toBe('https://x.example/v1/models');
  });

  it('带子路径的中转站也能处理', () => {
    expect(modelsEndpoint('https://gateway.example/openai/v1')).toBe(
      'https://gateway.example/openai/v1/models'
    );
  });
});

describe('parseModelIds', () => {
  it('认 OpenAI 的 { data: [...] }', () => {
    expect(parseModelIds({ data: [{ id: 'a' }, { id: 'b' }] })).toEqual(['a', 'b']);
  });

  it('认 { models: [...] }', () => {
    expect(parseModelIds({ models: [{ id: 'a' }, { id: 'c' }] })).toEqual(['a', 'c']);
  });

  it('元素直接是字符串也认', () => {
    expect(parseModelIds({ data: ['a', 'b'] })).toEqual(['a', 'b']);
  });

  it('去重、丢弃空值，并保持原顺序', () => {
    expect(parseModelIds({ data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }, { id: '' }, {}] })).toEqual(
      ['b', 'a']
    );
  });

  it('结构对不上时返回空数组，而不是抛错', () => {
    // 拉不到列表不该阻断流程，用户还能手填模型 id
    expect(parseModelIds(null)).toEqual([]);
    expect(parseModelIds({ 没有: 'data' })).toEqual([]);
    expect(parseModelIds('字符串')).toEqual([]);
  });
});

describe('fetchProviderModels', () => {
  const jsonResponse = (body: unknown, ok = true, status = 200) =>
    ({ ok, status, json: async () => body }) as unknown as Response;

  it('带回模型 id 列表，并带上 Bearer 凭证', async () => {
    const fetchLike = vi.fn(async () => jsonResponse({ data: [{ id: 'm1' }, { id: 'm2' }] })) as unknown as FetchLike;

    const models = await fetchProviderModels({
      baseUrl: 'https://x.example/v1',
      key: 'sk-1',
      fetchLike,
    });

    expect(models).toEqual(['m1', 'm2']);
    const [url, init] = (fetchLike as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('https://x.example/v1/models');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-1' });
  });

  it('没有 key 时不带 Authorization', async () => {
    const fetchLike = vi.fn(async () => jsonResponse({ data: [] })) as unknown as FetchLike;

    await fetchProviderModels({ baseUrl: 'https://x.example/v1', fetchLike });

    const [, init] = (fetchLike as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((init as RequestInit).headers).not.toHaveProperty('Authorization');
  });

  it('非 2xx 给可读错误，并带上状态码', async () => {
    const fetchLike = (async () => jsonResponse({}, false, 401)) as unknown as FetchLike;

    await expect(
      fetchProviderModels({ baseUrl: 'https://x.example/v1', fetchLike })
    ).rejects.toThrow(/401/);
  });

  it('返回的不是 JSON 时给可读错误', async () => {
    const fetchLike = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token <');
        },
      }) as unknown as Response) as unknown as FetchLike;

    await expect(
      fetchProviderModels({ baseUrl: 'https://x.example/v1', fetchLike })
    ).rejects.toThrow(/JSON/);
  });

  it('网络失败原样暴露，不吞掉', async () => {
    const fetchLike = (async () => {
      throw new Error('fetch failed');
    }) as unknown as FetchLike;

    await expect(
      fetchProviderModels({ baseUrl: 'https://x.example/v1', fetchLike })
    ).rejects.toThrow('fetch failed');
  });

  it('baseUrl 非法时在发请求之前就拒绝', async () => {
    const fetchLike = vi.fn() as unknown as FetchLike;

    await expect(
      fetchProviderModels({ baseUrl: 'file:///etc/passwd', fetchLike })
    ).rejects.toThrow();
    expect(fetchLike).not.toHaveBeenCalled();
  });
});

describe('SUPPORTED_APIS', () => {
  it('与 pi 文档里的四种 API 类型一致', () => {
    expect([...SUPPORTED_APIS]).toEqual([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ]);
  });
});
