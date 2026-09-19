/**
 * 上游 API 探针。
 *
 * 「环境自检」里那一行 API 上游不是只看端口通不通：它带上该供应商的密钥，去请求
 * 上游的模型列表，于是能一次验三样——地址通不通、密钥有没有效、这个模型在不在。
 * 用的是 `GET /models`（OpenAI 兼容协议的通用接口），不产生 token 花费。
 *
 * 拿不到列表的端点（404/405）不算失败：地址和网络是通的，只是没法核对模型。
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ApiProbeInput {
  modelId: string;
  baseUrl: string;
  /** pi 的模型对象里的 api 类型；决定鉴权头怎么带 */
  api: string;
  /** 没有密钥（订阅登录 / 没配）时只测地址可达 */
  key: string | null;
}

export interface ApiProbeResult {
  ok: boolean;
  status?: number;
  /** 响应头到达耗时（毫秒） */
  ms?: number;
  /** 列表里有没有这个模型；拿不到列表时为 null */
  modelFound?: boolean | null;
  /** 用上密钥了吗（没有就只能测地址） */
  keyUsed: boolean;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 10000;

export interface ProbeOptions {
  /** 注入点：测试里不发真实请求 */
  fetchLike?: FetchLike;
  timeoutMs?: number;
}

/** 只接受 http/https：这是桥接替前端发出去的请求，别放开别的协议 */
export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 版本段长得像 /v1、/v2（也有 /v1beta） */
const VERSION_SEGMENT = /\/v\d+[a-z0-9.-]*$/i;

/** 推测模型列表接口的地址：已经有版本段就直接接 /models，否则补一个 /v1 */
export function modelsEndpoint(baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (/\/models$/.test(base)) return base;
  if (VERSION_SEGMENT.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

/** 各家模型列表响应体 → 一组模型 id。结构对不上返回 null（拿不到列表） */
export function parseModelIds(payload: unknown): string[] | null {
  if (!payload || typeof payload !== 'object') return null;

  const record = payload as Record<string, unknown>;
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : null;
  if (!list) return null;

  const ids: string[] = [];
  for (const entry of list) {
    const raw =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object'
          ? ((entry as { id?: unknown }).id ?? (entry as { name?: unknown }).name ?? '')
          : '';

    // Google 的 id 长这样：models/gemini-3.8-flash
    const id = String(raw).replace(/^models\//, '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/**
 * 拉上游自己报的模型清单（`GET {地址}/models`）。
 *
 * 保存中转端点时用它：中转分组卖的模型名经常和官方不一样（真实案例里上游是
 * deepseek-v4-flash，内置目录是 deepseek-chat），照抄内置目录必然 model_not_found。
 *
 * 拿不到就返回 null（地址错 / 分组不暴露清单 / 密钥无效 / 网络问题）——
 * 这些都不该拦住建端点，调用方退回复制内置目录。
 */
export async function fetchUpstreamModelIds(
  baseUrl: string,
  key: string,
  options: ProbeOptions = {}
): Promise<string[] | null> {
  const fetchLike = options.fetchLike ?? ((url, init) => fetch(url, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchLike(modelsEndpoint(baseUrl), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const ids = parseModelIds(await response.json().catch(() => null));
    return ids && ids.length > 0 ? ids : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeApi(
  input: ApiProbeInput,
  options: ProbeOptions = {}
): Promise<ApiProbeResult> {
  const fetchLike = options.fetchLike ?? ((url, init) => fetch(url, init));
  const keyUsed = Boolean(input.key);

  let url = modelsEndpoint(input.baseUrl);
  const headers: Record<string, string> = { Accept: 'application/json' };

  if (input.key) {
    if (input.api === 'anthropic-messages') {
      headers['x-api-key'] = input.key;
      headers['anthropic-version'] = '2023-06-01';
    } else if (input.api === 'google-generative-ai') {
      url += `${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(input.key)}`;
    } else {
      headers.Authorization = `Bearer ${input.key}`;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetchLike(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    });
    // fetch 在收到响应头时就 resolve，这个差值天然是 TTFB
    const ms = Date.now() - startedAt;

    if (response.status === 401 || response.status === 403) {
      return { ok: false, status: response.status, ms, keyUsed, error: `鉴权失败（HTTP ${response.status}）` };
    }
    if (response.status === 404 || response.status === 405) {
      // 端点不提供模型列表：地址是通的，只是没法核对模型
      return { ok: true, status: response.status, ms, keyUsed, modelFound: null };
    }
    if (!response.ok) {
      return { ok: false, status: response.status, ms, keyUsed, error: `HTTP ${response.status}` };
    }

    let ids: string[] | null = null;
    try {
      ids = parseModelIds(await response.json());
    } catch {
      ids = null;
    }

    return {
      ok: true,
      status: response.status,
      ms,
      keyUsed,
      modelFound: ids ? ids.includes(input.modelId) : null,
    };
  } catch (err) {
    return {
      ok: false,
      keyUsed,
      error: controller.signal.aborted
        ? `超时（${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000} 秒）`
        : String((err as Error)?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}
