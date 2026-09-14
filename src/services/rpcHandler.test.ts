import { describe, expect, it } from 'vitest';
import { RpcEventHandler } from './rpcHandler';

const wsStub = () => {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1,
    send: (raw: string) => {
      sent.push(raw);
    },
  } as unknown as WebSocket & { sent: string[] };
};

function createHarness() {
  let messages: any[] = [];
  let status: any = { isStreaming: false };
  const handler = new RpcEventHandler(
    ((updater: any) => {
      messages = typeof updater === 'function' ? updater(messages) : updater;
    }) as any,
    ((updater: any) => {
      status = typeof updater === 'function' ? updater(status) : updater;
    }) as any
  );
  const ws = wsStub();
  return {
    handler,
    ws,
    messages: () => messages,
    setMessages: (next: any[]) => {
      messages = next;
    },
    status: () => status,
    setStatus: (next: any) => {
      status = next;
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

/** 模拟 usePiWebSocket.sendPrompt 建立一轮：占位消息 + currentAssistantId */
function startTurn(h: Harness, id = 'asst-1') {
  h.setMessages([{ id, role: 'assistant', content: '', reasoning: '', status: 'streaming' }]);
  h.setStatus({ isStreaming: false });
  h.handler.setCurrentAssistantId(id);
  h.handler.handleEvent({ type: 'agent_start' }, h.ws);
}

describe('流式增量', () => {
  it('text_delta 追加到 content，thinking_delta 追加到 reasoning', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '你' } }, h.ws);
    h.handler.handleEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '好' } }, h.ws);
    h.handler.handleEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '想' } }, h.ws);

    expect(h.messages()[0].content).toBe('你好');
    expect(h.messages()[0].reasoning).toBe('想');
  });

  it('没有 currentAssistantId 时忽略增量，不抛错', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'x' } }, h.ws);
    expect(h.messages()).toEqual([]);
  });
});

describe('一轮的收尾时机', () => {
  it('agent_end 携带 willRetry 时保持生成中', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'agent_end', willRetry: true }, h.ws);

    expect(h.status().isStreaming).toBe(true);
    expect(h.messages()[0].status).toBe('streaming');
  });

  it('agent_end 不带重试也要等 agent_settled 才收尾', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'agent_end', willRetry: false }, h.ws);

    expect(h.status().isStreaming).toBe(true);
    expect(h.messages()[0].status).toBe('streaming');
  });

  it('agent_settled 收尾并清空 currentAssistantId', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'agent_settled' }, h.ws);

    expect(h.status().isStreaming).toBe(false);
    expect(h.status().currentTool).toBeUndefined();
    expect(h.messages()[0].status).toBe('done');
    expect(h.messages()[0].error).toBeUndefined();
    expect((h.handler as any).currentAssistantId).toBeNull();
  });

  it('收尾后重复的 agent_settled 不改变已完成的消息', () => {
    const h = createHarness();
    startTurn(h);
    h.handler.handleEvent({ type: 'agent_settled' }, h.ws);
    const before = h.messages();

    h.handler.handleEvent({ type: 'agent_settled' }, h.ws);

    expect(h.messages()).toEqual(before);
  });
});

describe('get_state 与执行状态', () => {
  const stateEvent = (isStreaming: boolean) => ({
    type: 'response',
    command: 'get_state',
    success: true,
    data: { isStreaming, thinkingLevel: 'high', sessionId: 's1', model: { id: 'm', name: 'M', provider: 'p' } },
  });

  it('本地没有进行中的轮次时采纳 isStreaming', () => {
    const h = createHarness();
    h.handler.handleEvent(stateEvent(true), h.ws);
    expect(h.status().isStreaming).toBe(true);
    expect(h.status().model.id).toBe('m');
    expect(h.status().thinkingLevel).toBe('high');
  });

  it('本地正在生成时不被回包覆盖', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(stateEvent(false), h.ws);

    expect(h.status().isStreaming).toBe(true);
  });
});

describe('失败路径', () => {
  it('pi 进程退出时收尾并把原因写进消息', () => {
    const h = createHarness();
    startTurn(h);
    h.setStatus({ ...h.status(), isStreaming: true, currentTool: 'bash' });

    h.handler.handleEvent({ type: 'pi_process_exit', code: 1 }, h.ws);

    expect(h.status().isStreaming).toBe(false);
    expect(h.status().currentTool).toBeUndefined();
    expect(h.messages()[0].status).toBe('error');
    expect(h.messages()[0].error).toContain('1');
  });

  it('pi 进程启动失败时带上错误信息', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'pi_process_error', error: 'spawn pi ENOENT' }, h.ws);

    expect(h.messages()[0].status).toBe('error');
    expect(h.messages()[0].error).toBe('spawn pi ENOENT');
  });

  it('桥接报错（如非法工作目录）会被展示', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'bridge_error', error: '无法切换工作目录：X 不存在或不是目录' }, h.ws);

    expect(h.status().isStreaming).toBe(false);
    expect(h.messages()[0].status).toBe('error');
    expect(h.messages()[0].error).toContain('不存在');
  });
});

describe('工具调用', () => {
  it('start/update/end 依次更新同一条工具', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } }, h.ws);
    expect(h.messages()[0].tools[0]).toMatchObject({ id: 't1', name: 'bash', status: 'running' });
    expect(h.status().currentTool).toBe('bash');

    h.handler.handleEvent(
      { type: 'tool_execution_update', toolCallId: 't1', partialResult: { content: [{ type: 'text', text: '部分输出' }] } },
      h.ws
    );
    expect(h.messages()[0].tools[0].result).toBe('部分输出');

    h.handler.handleEvent(
      { type: 'tool_execution_end', toolCallId: 't1', result: { content: [{ type: 'text', text: '最终输出' }] } },
      h.ws
    );
    expect(h.messages()[0].tools[0]).toMatchObject({ status: 'done', result: '最终输出' });
    expect(h.status().currentTool).toBeUndefined();
  });

  it('重复的 tool_execution_start 不会插入第二条', () => {
    const h = createHarness();
    startTurn(h);

    const start = { type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: {} };
    h.handler.handleEvent(start, h.ws);
    h.handler.handleEvent(start, h.ws);

    expect(h.messages()[0].tools).toHaveLength(1);
  });
});

describe('会话列表事件', () => {
  it('sessions_list 写入 status', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'sessions_list', sessions: [{ path: '/a.jsonl', id: 'a' }] }, h.ws);
    expect(h.status().sessions).toEqual([{ path: '/a.jsonl', id: 'a' }]);
  });

  it('重命名成功后重新拉取列表', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'session_renamed', success: true }, h.ws);
    expect(h.ws.sent).toContain(JSON.stringify({ type: 'list_sessions' }));
  });

  it('重命名失败时不刷新列表', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'session_renamed', success: false }, h.ws);
    expect(h.ws.sent).toEqual([]);
  });

  it('sessions_list 记录总数，便于提示列表被截断', () => {
    const h = createHarness();
    h.handler.handleEvent(
      { type: 'sessions_list', sessions: [{ path: '/a.jsonl', id: 'a' }], total: 300 },
      h.ws
    );

    expect(h.status().sessionsTotal).toBe(300);
  });

  it('没有 total 时退回按列表长度计', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'sessions_list', sessions: [{ path: '/a.jsonl', id: 'a' }] }, h.ws);
    expect(h.status().sessionsTotal).toBe(1);
  });

  it('trash_list 写入回收箱内容', () => {
    const h = createHarness();
    h.handler.handleEvent(
      { type: 'trash_list', sessions: [{ path: '/t.jsonl', id: 't', preview: '删掉的' }] },
      h.ws
    );

    expect(h.status().trashed).toEqual([{ path: '/t.jsonl', id: 't', preview: '删掉的' }]);
  });

  it('移入回收箱成功后两个列表都刷新', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'session_trashed', success: true }, h.ws);

    expect(h.ws.sent).toContain(JSON.stringify({ type: 'list_sessions' }));
    expect(h.ws.sent).toContain(JSON.stringify({ type: 'list_trash' }));
  });

  it('移入回收箱失败时不刷新', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'session_trashed', success: false }, h.ws);
    expect(h.ws.sent).toEqual([]);
  });

  it('恢复 / 彻底删除 / 清空回收箱都会刷新两个列表', () => {
    for (const type of ['session_restored', 'session_purged', 'trash_emptied']) {
      const h = createHarness();
      h.handler.handleEvent({ type, success: true }, h.ws);

      expect(h.ws.sent, type).toContain(JSON.stringify({ type: 'list_sessions' }));
      expect(h.ws.sent, type).toContain(JSON.stringify({ type: 'list_trash' }));
    }
  });
});
