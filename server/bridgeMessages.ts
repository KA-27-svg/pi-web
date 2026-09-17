/**
 * 指令没能送进 pi 时的回包。
 *
 * 关键点：如果原指令带着请求 id（`request()` 发的那种），回包必须原样带回去。
 * 前端按 id 配对，不带 id 就配不上号，那条 Promise 只能干等到 60 秒超时——
 * 表现成「点了停止没反应」。带上 id，前端立刻拿到失败，马上走下一步。
 */
export function piNotReadyReply(command: object): string {
  const id = (command as { id?: unknown }).id;
  return JSON.stringify({
    type: 'bridge_error',
    error: 'Pi 进程未就绪，指令没有送达',
    ...(typeof id === 'string' ? { id } : {}),
  });
}
