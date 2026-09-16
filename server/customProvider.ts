/**
 * 自定义端点（中转站 / 自建服务）。
 *
 * pi 的内置目录只覆盖官方供应商，剩下的一律靠 `models.json` 声明：给一个
 * `baseUrl`、一个 API 类型、一组模型 id。所以向导要么让用户手填模型 id，
 * 要么替他从 `<baseUrl>/models` 拉一份——后者是大多数 OpenAI 兼容端点都支持的接口。
 */

/** pi 支持的四种 API 类型 */
export const SUPPORTED_APIS = [
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
] as const;

export type SupportedApi = (typeof SUPPORTED_APIS)[number];

/**
 * 规整用户填的 baseUrl。
 *
 * 只接受 http/https：这里是桥接主动发出去的请求，放开别的协议等于给自己开了个
 * 能读本地文件的接口。
 */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('API 地址不能为空');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`不是合法的 URL：${trimmed}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('API 地址必须以 http:// 或 https:// 开头');
  }

  // 结尾斜杠交给 modelsEndpoint 处理，这里统一去掉
  return trimmed.replace(/\/+$/, '');
}

/** 版本段长得像 /v1、/v2（也有写成 /v1beta 的，一并认） */
const VERSION_SEGMENT = /\/v\d+[a-z0-9.-]*$/i;

/**
 * 推测模型列表接口的地址。
 *
 * 用户可能贴 `https://api.deepseek.com`，也可能贴完整的 `https://api.deepseek.com/v1`，
 * 两种都得能用：已经有版本段就直接接 `/models`，否则补一个 `/v1`。
 */
export function modelsEndpoint(baseUrl: string): string {
  const base = normalizeBaseUrl(baseUrl);
  if (/\/models$/.test(base)) return base;
  if (VERSION_SEGMENT.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

/** 把各家五花八门的响应体抽成一组模型 id。结构对不上就返回空数组 */
export function parseModelIds(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];

  const record = payload as Record<string, unknown>;
  const list = Array.isArray(record.data)
    ? record.data
    : Array.isArray(record.models)
      ? record.models
      : null;
  if (!list) return [];

  const ids: string[] = [];
  for (const entry of list) {
    const id =
      typeof entry === 'string'
        ? entry
        : entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string'
          ? (entry as { id: string }).id
          : '';

    const trimmed = id.trim();
    if (trimmed && !ids.includes(trimmed)) ids.push(trimmed);
  }

  return ids;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface FetchModelsOptions {
  baseUrl: string;
  key?: string;
  /** 默认用全局 fetch；注入是为了测试不发真实请求 */
  fetchLike?: FetchLike;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 从 `<baseUrl>/models` 拉模型列表。
 *
 * 失败一律抛错——由调用方退化成「手填模型 id」。这里不返回空数组冒充成功，
 * 否则界面会显示一个空下拉框，用户不知道是自己地址填错了还是服务端没模型。
 */
export async function fetchProviderModels(options: FetchModelsOptions): Promise<string[]> {
  const url = modelsEndpoint(options.baseUrl);
  const fetchLike = options.fetchLike ?? ((input, init) => fetch(input, init));
  const key = options.key?.trim();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetchLike(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) throw new Error('拉取模型列表超时，可以直接手填模型 id');
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`拉取模型列表失败（HTTP ${response.status}），可以直接手填模型 id`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('模型列表不是合法的 JSON，可以直接手填模型 id');
  }

  return parseModelIds(payload);
}
