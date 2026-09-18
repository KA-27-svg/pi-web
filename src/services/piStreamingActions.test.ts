import { describe, expect, it, vi } from 'vitest';
import type { PiBridge } from './piBridge';
import { createStreamingActions } from './piStreamingActions';

function harness(options: { open?: boolean; clearQueue?: unknown } = {}) {
  const open = options.open ?? true;
  const sent: Record<string, any>[] = [];
  const statuses: any[] = [];
  let messages: any[] = [];

  const handler = { setCurrentAssistantId: vi.fn(), abortTurn: vi.fn() };
  const request = vi.fn(async () => options.clearQueue ?? { data: { steering: [], followUp: [] } });

  const bridge = {
    setMessages: (updater: any) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    },
    setStatus: (updater: any) => {
      statuses.push(typeof updater === 'function' ? updater({}) : updater);
    },
    handler: handler as never,
    request,
    sendCommand: (command: object) => {
      sent.push(command as Record<string, any>);
    },
    isOpen: () => open,
  } as unknown as PiBridge;

  return {
    actions: createStreamingActions(bridge),
    sent,
    statuses,
    messages: () => messages,
    handler,
    request,
  };
}

const draft = (text: string) => ({ text, images: [], files: [] });

describe('streaming 动作', () => {
  it('空草稿什么都不发，返回 false', () => {
    const { actions, sent } = harness();

    expect(actions.sendPrompt(draft('   '))).toBe(false);
    expect(sent).toEqual([]);
  });

  it('连接断开时不发消息、返回 false（好让输入框保留草稿）', () => {
    const { actions, sent } = harness({ open: false });

    expect(actions.sendPrompt(draft('你好'))).toBe(false);
    expect(sent).toEqual([]);
  });

  it('普通发送：先放 user + assistant 占位，再发 prompt', () => {
    const { actions, sent, messages, handler, statuses } = harness();

    expect(actions.sendPrompt(draft('你好'))).toBe(true);

    const msgs = messages();
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[0].content).toBe('你好');
    expect(msgs[1].status).toBe('streaming');
    expect(handler.setCurrentAssistantId).toHaveBeenCalledWith(msgs[1].id);
    expect(sent[0]).toMatchObject({ type: 'prompt', message: '你好' });
    expect(statuses[0].isStreaming).toBe(true);
  });

  it('生成中排队：带 streamingBehavior: followUp，并把消息标成 queued', () => {
    const { actions, sent, messages, handler } = harness();

    actions.sendPrompt(draft('排队'), { queue: true });

    expect(sent[0]).toMatchObject({ type: 'prompt', streamingBehavior: 'followUp' });
    expect(messages().some(m => m.queued)).toBe(true);
    // 排队时没有占位消息：pi 真正开始这一轮会发 agent_start，占位在那里补
    expect(handler.setCurrentAssistantId).not.toHaveBeenCalled();
  });

  it('abort：本地收尾 + 发 abort，不等 pi 回包', () => {
    const { actions, sent, handler } = harness();

    actions.abort();

    expect(handler.abortTurn).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([{ type: 'abort' }]);
  });

  it('interrupt：先 clear_queue，再 abort，并把队列文本取回输入栏', async () => {
    const { actions, sent, handler, statuses, request } = harness({
      clearQueue: { data: { steering: ['改一下'], followUp: ['第二句'] } },
    });

    await actions.interrupt();

    expect(request).toHaveBeenCalledWith('clear_queue');
    expect(sent).toEqual([{ type: 'abort' }]);
    expect(handler.abortTurn).toHaveBeenCalledTimes(1);
    const restored = statuses.find(s => s.restoredDraft)?.restoredDraft;
    expect(restored.text).toBe('改一下\n\n第二句');
    expect(restored.seq).toBeGreaterThan(0);
  });

  it('clear_queue 失败也照样打断（没有队列 / 旧版桥接）', async () => {
    const { actions, sent, handler, request } = harness();
    request.mockRejectedValueOnce(new Error('Unknown command'));

    await actions.interrupt();

    expect(sent).toEqual([{ type: 'abort' }]);
    expect(handler.abortTurn).toHaveBeenCalledTimes(1);
  });

  it('changeCwd / newSession / setModel / setThinkingLevel 的指令形状', () => {
    const { actions, sent, handler } = harness();

    actions.changeCwd('C:/x');
    actions.newSession();
    actions.setModel('anthropic', 'claude');
    actions.setThinkingLevel('high');
    actions.compactContext();

    expect(sent).toEqual([
      { type: 'change_cwd', cwd: 'C:/x' },
      { type: 'new_session' },
      { type: 'set_model', provider: 'anthropic', modelId: 'claude' },
      { type: 'set_thinking_level', level: 'high' },
      { type: 'compact' },
    ]);
    expect(handler.setCurrentAssistantId).toHaveBeenCalledWith(null);
  });
});
