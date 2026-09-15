import { WebSocket } from 'ws';

/**
 * 统一的「跑一个异步操作 → 回一条结果」封装。
 *
 * - `payload` 只用于成功分支，把操作结果带回去
 * - `extra` 成功与失败**都会**带上：请求方靠它配对（例如上传请求的 id）。
 *   漏在失败分支上，前端就永远配不上号，只能一直等到超时——而不是立刻看到错误。
 */
export function reply<T>(
  ws: WebSocket,
  type: string,
  run: () => Promise<T>,
  payload?: (value: T) => Record<string, unknown>,
  extra?: () => Record<string, unknown>
) {
  // 立刻求值：放进 catch 里再算，extra 自己抛错就会变成未捕获的 rejection
  const extraFields = extra?.() ?? {};

  run()
    .then(value => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({ type, success: true, ...extraFields, ...(payload?.(value) ?? {}) })
      );
    })
    .catch(err => {
      console.error(`[Pi Bridge] ${type} failed:`, err);
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          type,
          success: false,
          error: String(err?.message ?? err),
          ...extraFields,
        })
      );
    });
}
