import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { reply } from './reply';

const fakeWs = () => {
  const sent: string[] = [];
  return {
    sent,
    parsed: () => sent.map(raw => JSON.parse(raw)),
    readyState: WebSocket.OPEN,
    send: (raw: string) => {
      sent.push(raw);
    },
  } as unknown as WebSocket & { sent: string[]; parsed: () => any[] };
};

/** reply 是「跑完再回」，等一个宏任务让 then/catch 落地 */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('reply', () => {
  it('成功时带上 payload', async () => {
    const ws = fakeWs();

    reply(ws, 'thing_done', async () => 42, value => ({ answer: value }));
    await settle();

    expect((ws as any).parsed()[0]).toEqual({ type: 'thing_done', success: true, answer: 42 });
  });

  it('失败时带上错误信息', async () => {
    const ws = fakeWs();

    reply(ws, 'thing_done', async () => {
      throw new Error('炸了');
    });
    await settle();

    expect((ws as any).parsed()[0]).toEqual({
      type: 'thing_done',
      success: false,
      error: '炸了',
    });
  });

  it('extra 在成功与失败时都会带上——请求方靠它配对', async () => {
    // 上传失败时如果丢了 id，前端就永远等不到回包，只能靠超时
    const ok = fakeWs();
    reply(ok, 'file_uploaded', async () => ({ path: '/a' }), v => ({ ...v }), () => ({ id: 'up-1' }));
    await settle();
    expect((ok as any).parsed()[0]).toMatchObject({ success: true, id: 'up-1', path: '/a' });

    const bad = fakeWs();
    reply(
      bad,
      'file_uploaded',
      async () => {
        throw new Error('文件太大');
      },
      // 不给 payload：失败分支本来也用不到它，顺带证明 extra 不依赖 payload
      undefined,
      () => ({ id: 'up-2' })
    );
    await settle();
    expect((bad as any).parsed()[0]).toMatchObject({
      success: false,
      id: 'up-2',
      error: '文件太大',
    });
  });

  it('客户端已断开时不再写 socket，也不抛错', async () => {
    const ws = fakeWs();
    (ws as unknown as { readyState: number }).readyState = WebSocket.CLOSED;

    reply(ws, 'thing_done', async () => 1);
    await settle();

    expect((ws as any).sent).toEqual([]);
  });

  it('payload 抛错不会把异常漏到调用方', async () => {
    const ws = fakeWs();
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});

    reply(ws, 'thing_done', async () => 1, () => {
      throw new Error('payload 里炸了');
    });
    await settle();

    expect(onError).toHaveBeenCalled();
    onError.mockRestore();
  });

  it('返回的 Promise 在 run 真的完成后才 resolve，供调用方排序后续动作', async () => {
    const ws = fakeWs();
    let written = false;

    const done = reply(ws, 'provider_saved', async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      written = true;
      return {};
    });

    // 还没写完就不能 resolve：抢在写盘前刷新，读到的会是旧配置
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    expect(settled).toBe(false);
    expect(written).toBe(false);

    await done;
    expect(written).toBe(true);
    expect(settled).toBe(true);
  });

  it('run 失败时返回的 Promise 正常 resolve，不把拒绝抛给调用方', async () => {
    const ws = fakeWs();
    const onError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      reply(ws, 'thing_done', async () => {
        throw new Error('写盘失败');
      })
    ).resolves.toBeUndefined();

    onError.mockRestore();
  });
});
