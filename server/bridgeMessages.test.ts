import { describe, expect, it } from 'vitest';
import { piNotReadyReply } from './bridgeMessages';

describe('piNotReadyReply', () => {
  it('带上请求 id，前端才能立刻失败而不是干等 60 秒超时', () => {
    // clear_queue 没送达时，interrupt 会一直 await 到超时才 abort，
    // 表现成「点了停止没反应」
    const reply = JSON.parse(piNotReadyReply({ type: 'clear_queue', id: 'req-1' }));

    expect(reply).toEqual({
      type: 'bridge_error',
      error: 'Pi 进程未就绪，指令没有送达',
      id: 'req-1',
    });
  });

  it('没有 id 的普通指令（广播）不带 id', () => {
    const reply = JSON.parse(piNotReadyReply({ type: 'set_model' }));

    expect(reply).toEqual({
      type: 'bridge_error',
      error: 'Pi 进程未就绪，指令没有送达',
    });
    expect('id' in reply).toBe(false);
  });
});
