/**
 * 网络连通性检测。
 *
 * 环境自检只看本机（Node / pi / Git Bash / 凭证），不碰网络；而首次安装依赖、
 * 装 pi、以及真正对话都要联网。这里补上「这个地址现在通不通」。
 *
 * 判据是「服务端有没有回 HTTP」：哪怕回 401 / 404 也算通——说明 DNS、TCP、TLS
 * 都走通了，只是这次请求没带凭证或路径不对。只有连不上 / 超时才算不通。
 */

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface ConnectivityTarget {
  id: string;
  url: string;
}

export interface ConnectivityResult {
  id: string;
  url: string;
  ok: boolean;
  /** 服务端回的 HTTP 状态码（通了才有） */
  status?: number;
  /** 不通时的原因（连不上 / 超时） */
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;

/** 只接受 http/https：这里是桥接替前端发出去的请求，别放开别的协议 */
export function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export interface CheckOptions {
  /** 注入点：测试里不发真实请求 */
  fetchLike?: FetchLike;
  timeoutMs?: number;
}

export async function checkUrl(
  url: string,
  options: CheckOptions = {}
): Promise<Omit<ConnectivityResult, 'id'>> {
  const fetchLike = options.fetchLike ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetchLike(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
    });
    return { url, ok: true, status: response.status };
  } catch (err) {
    return {
      url,
      ok: false,
      error: controller.signal.aborted
        ? `超时（${(options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000} 秒）`
        : String((err as Error)?.message ?? err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 并发测一组地址；非法地址直接判为不通，不会真的去请求 */
export async function checkTargets(
  targets: ConnectivityTarget[],
  options: CheckOptions = {}
): Promise<ConnectivityResult[]> {
  return Promise.all(
    targets.map(async target => {
      if (!isHttpUrl(target.url)) {
        return { id: target.id, url: target.url, ok: false, error: '地址不是 http/https' };
      }
      return { id: target.id, ...(await checkUrl(target.url, options)) };
    })
  );
}
