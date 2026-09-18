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

describe('切换模型', () => {
  const setModelOk = (provider = 'openai', id = 'gpt-5') => ({
    type: 'response',
    command: 'set_model',
    success: true,
    data: { id, name: id, provider },
  });

  it('成功后顺手把默认模型写进设置，否则重启桥接就回到旧模型', () => {
    const h = createHarness();

    h.handler.handleEvent(setModelOk(), h.ws);

    expect(h.status().model.id).toBe('gpt-5');
    const sent = h.ws.sent.map(raw => JSON.parse(raw));
    expect(sent).toContainEqual({
      type: 'set_default_model',
      provider: 'openai',
      modelId: 'gpt-5',
    });
  });

  it('失败时给出可见提示，而不是静默地把菜单关掉', () => {
    const h = createHarness();

    h.handler.handleEvent(
      {
        type: 'response',
        command: 'set_model',
        success: false,
        error: 'Model not found: invalid/model',
      },
      h.ws
    );

    expect(h.status().modelNotice).toContain('Model not found');
    expect(h.status().model).toBeUndefined();
  });

  it('失败时不把无效模型写成默认', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'response', command: 'set_model', success: false, error: '炸了' },
      h.ws
    );

    const sent = h.ws.sent.map(raw => JSON.parse(raw));
    expect(sent.some(m => m.type === 'set_default_model')).toBe(false);
  });

  it('保存默认失败时也在这里报，而不是丢给供应商表单', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'default_model_saved', success: false, error: 'settings.json 不是合法的 JSON' },
      h.ws
    );

    expect(h.status().modelNotice).toContain('settings.json');
  });

  it('思考强度设置失败也报出来，和切模型一致', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'response', command: 'set_thinking_level', success: false, error: '不支持' },
      h.ws
    );

    expect(h.status().modelNotice).toContain('思考强度');
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

  it('桥接报错时也留一条可见提示，即使没有进行中的消息', () => {
    // 例如切换工作目录失败：没有占位消息可写 error，不提示就等于点了没反应
    const h = createHarness();
    h.setMessages([{ id: 'old', role: 'assistant', content: '旧内容', status: 'done' }]);

    h.handler.handleEvent({ type: 'bridge_error', error: '无法切换工作目录：X 不存在或不是目录' }, h.ws);

    expect(h.status().notice).toContain('不存在');
    expect(h.messages()[0].status).toBe('done');
  });
});

describe('用户中止', () => {
  const stateEvent = (isStreaming: boolean) => ({
    type: 'response',
    command: 'get_state',
    success: true,
    data: { isStreaming, thinkingLevel: 'high', sessionId: 's1', model: { id: 'm', name: 'M', provider: 'p' } },
  });

  it('本地立刻收尾，并把占位消息落定为完成', () => {
    const h = createHarness();
    startTurn(h);
    h.handler.handleEvent(
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '说到一半' } },
      h.ws
    );

    h.handler.abortTurn();

    expect(h.status().isStreaming).toBe(false);
    expect(h.messages()[0].status).toBe('done');
    expect(h.messages()[0].content).toBe('说到一半');
  });

  it('停止之后迟到的 get_state 不会把状态改回生成中', () => {
    // abort 之后任何一次 get_state（例如切模型触发）都会重算 isStreaming；
    // 如果还留着 currentAssistantId，按钮会闪回「停止生成」
    const h = createHarness();
    startTurn(h);

    h.handler.abortTurn();
    h.handler.handleEvent(stateEvent(false), h.ws);

    expect(h.status().isStreaming).toBe(false);
  });

  it('停止之后迟到的增量被忽略', () => {
    const h = createHarness();
    startTurn(h);
    h.handler.abortTurn();

    h.handler.handleEvent(
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '不要了' } },
      h.ws
    );

    expect(h.messages()[0].content).toBe('');
  });

  it('随后到达的 agent_settled 不会把消息改成失败或重复收尾', () => {
    const h = createHarness();
    startTurn(h);
    h.handler.abortTurn();
    const before = h.messages();

    h.handler.handleEvent({ type: 'agent_settled' }, h.ws);

    expect(h.messages()).toEqual(before);
    expect(h.messages()[0].status).toBe('done');
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

describe('切换会话时的消息处理', () => {
  const historyResponse = (texts: string[]) => ({
    type: 'response',
    command: 'get_messages',
    success: true,
    data: {
      messages: texts.map((text, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: text,
        timestamp: i,
      })),
    },
  });

  const switchOk = { type: 'response', command: 'switch_session', success: true, data: {} };
  const oldMessages = [{ id: 'old', role: 'assistant', content: '上一个会话', status: 'done' }];

  it('切换成功时不清空，避免中间多出一帧空对话', () => {
    // 那一帧空对话会让底部输入区位置与滚动位置先弹一次，
    // 并且消息节点全被卸载重建、重播入场动画
    const h = createHarness();
    h.setMessages(oldMessages);

    h.handler.handleEvent(switchOk, h.ws);

    expect(h.messages()).toHaveLength(1);
    expect(h.ws.sent).toContain(JSON.stringify({ type: 'get_messages' }));
  });

  it('切换后到达的历史会替换掉旧会话内容', () => {
    const h = createHarness();
    h.setMessages(oldMessages);
    h.handler.handleEvent(switchOk, h.ws);

    h.handler.handleEvent(historyResponse(['新问题', '新回答']), h.ws);

    expect(h.messages().map(m => m.content)).toEqual(['新问题', '新回答']);
  });

  it('切换失败时不动现有消息，并给出提示', () => {
    const h = createHarness();
    h.setMessages(oldMessages);

    h.handler.handleEvent(
      { type: 'response', command: 'switch_session', success: false, error: '目录不存在' },
      h.ws
    );

    expect(h.messages().map(m => m.content)).toEqual(['上一个会话']);
    expect(h.status().notice).toContain('目录不存在');
  });

  it('没有切换时的历史补拉不覆盖本地消息', () => {
    const h = createHarness();
    h.setMessages([{ id: 'live', role: 'assistant', content: '本地内容', status: 'done' }]);

    h.handler.handleEvent(historyResponse(['服务器上的旧内容']), h.ws);

    expect(h.messages().map(m => m.content)).toEqual(['本地内容']);
  });

  it('本地为空时（首屏）仍然用历史填充', () => {
    const h = createHarness();

    h.handler.handleEvent(historyResponse(['历史']), h.ws);

    expect(h.messages().map(m => m.content)).toEqual(['历史']);
  });

  it('新建会话仍然清空消息', () => {
    const h = createHarness();
    h.setMessages(oldMessages);

    h.handler.handleEvent(
      { type: 'response', command: 'new_session', success: true, data: {} },
      h.ws
    );

    expect(h.messages()).toEqual([]);
  });

  it('新建会话被取消时给出提示，而不是静默空着', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'response', command: 'new_session', success: false, error: '被扩展取消' },
      h.ws
    );

    expect(h.status().notice).toContain('被扩展取消');
  });
});

describe('切换中的状态', () => {
  const switchOk = { type: 'response', command: 'switch_session', success: true, data: {} };
  const history = (texts: string[]) => ({
    type: 'response',
    command: 'get_messages',
    success: true,
    data: { messages: texts.map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', content: text, timestamp: i })) },
  });

  it('点下会话就进入切换中，并清掉上一次的提示', () => {
    const h = createHarness();
    h.setStatus({ ...h.status(), notice: '上一次的错误' });

    h.handler.beginSwitch();

    expect(h.status().switching).toBe(true);
    expect(h.status().notice).toBeUndefined();
  });

  it('到历史到达之前一直保持切换中', () => {
    const h = createHarness();
    h.handler.beginSwitch();

    h.handler.handleEvent(switchOk, h.ws);

    expect(h.status().switching).toBe(true);
  });

  it('历史到达后结束切换中并换成新内容', () => {
    const h = createHarness();
    h.handler.beginSwitch();
    h.handler.handleEvent(switchOk, h.ws);

    h.handler.handleEvent(history(['新问题']), h.ws);

    expect(h.status().switching).toBe(false);
    expect(h.messages().map(m => m.content)).toEqual(['新问题']);
  });

  it('切换失败时不卡在切换中，并把原会话拉回来', () => {
    const h = createHarness();
    h.setMessages([{ id: 'old', role: 'assistant', content: '旧内容', status: 'done' }]);
    h.handler.beginSwitch();

    h.handler.handleEvent(
      { type: 'response', command: 'switch_session', success: false, error: '目录不存在' },
      h.ws
    );
    // pi 其实还停在原会话上，所以再拉一次把界面换回去
    h.handler.handleEvent(history(['原会话内容']), h.ws);

    expect(h.status().switching).toBe(false);
    expect(h.messages().map(m => m.content)).toEqual(['原会话内容']);
    expect(h.status().notice).toContain('目录不存在');
  });

  it('pi 出错时不会让对话区一直空着', () => {
    const h = createHarness();
    h.handler.beginSwitch();

    h.handler.handleEvent({ type: 'pi_process_exit', code: 1 }, h.ws);

    expect(h.status().switching).toBe(false);
  });
});

describe('会话是否已载入', () => {
  const history = (texts: string[]) => ({
    type: 'response',
    command: 'get_messages',
    success: true,
    data: { messages: texts.map((text, i) => ({ role: i % 2 ? 'assistant' : 'user', content: text, timestamp: i })) },
  });

  it('拿到消息之前不声称已载入', () => {
    // 界面靠它来决定要不要进入「空白态」；
    // 早一步置真，刷新已有对话时就会先演一遍开场形变
    const h = createHarness();
    expect(h.status().sessionLoaded).toBeUndefined();
  });

  it('拿到消息之后标记为已载入', () => {
    const h = createHarness();

    h.handler.handleEvent(history(['一']), h.ws);

    expect(h.status().sessionLoaded).toBe(true);
  });

  it('空会话也算已载入（此时才该显示开场图标）', () => {
    const h = createHarness();

    h.handler.handleEvent(history([]), h.ws);

    expect(h.status().sessionLoaded).toBe(true);
  });
});

describe('会话用量', () => {
  const statsEvent = (overrides: Record<string, unknown> = {}) => ({
    type: 'response',
    command: 'get_session_stats',
    success: true,
    data: {
      tokens: { input: 7274, output: 714, cacheRead: 183040, cacheWrite: 0, total: 191028 },
      cost: 0.00413724,
      contextUsage: { tokens: 191028, contextWindow: 200000, percent: 95 },
      ...overrides,
    },
  });

  const requestedStats = (h: Harness) =>
    h.ws.sent.filter(raw => raw.includes('get_session_stats'));

  it('回包写入 status.stats', () => {
    const h = createHarness();

    h.handler.handleEvent(statsEvent(), h.ws);

    expect(h.status().stats.cost).toBe(0.00413724);
    expect(h.status().stats.tokens.cacheRead).toBe(183040);
    expect(h.status().stats.contextUsage.percent).toBe(95);
  });

  it('一轮收尾（agent_settled）后自动重取，账目随回复更新', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'agent_settled' }, h.ws);

    expect(requestedStats(h)).toHaveLength(1);
  });

  it('新建会话后重取，避免还显示上一个会话的花费', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'response', command: 'new_session', success: true, data: {} },
      h.ws
    );

    expect(requestedStats(h)).toHaveLength(1);
  });

  it('切换会话后重取', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'response', command: 'switch_session', success: true, data: {} },
      h.ws
    );

    expect(requestedStats(h)).toHaveLength(1);
  });

  it('失败的回包不覆盖已有数据', () => {
    const h = createHarness();
    h.handler.handleEvent(statsEvent(), h.ws);

    h.handler.handleEvent(
      { type: 'response', command: 'get_session_stats', success: false, error: 'boom' },
      h.ws
    );

    expect(h.status().stats.cost).toBe(0.00413724);
  });
});

describe('生成中排队与中断', () => {
  it('agent_start 时本地没有占位就补一条，否则排队消息的增量会落空', () => {
    const h = createHarness();
    h.setMessages([]);
    h.setStatus({ isStreaming: false });

    h.handler.handleEvent({ type: 'agent_start' }, h.ws);

    expect(h.messages()).toHaveLength(1);
    expect(h.messages()[0].role).toBe('assistant');
    expect(h.messages()[0].status).toBe('streaming');
  });

  it('已经有占位时不重复创建', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent({ type: 'agent_start' }, h.ws);

    expect(h.messages()).toHaveLength(1);
  });

  it('pi 开始处理队列时清掉最早一条 queued 标记，中断就不该再收回它', () => {
    const h = createHarness();
    h.setMessages([
      { id: 'u1', role: 'user', content: '第一句', queued: true, status: 'done', timestamp: 0 },
      { id: 'u2', role: 'user', content: '第二句', queued: true, status: 'done', timestamp: 0 },
    ]);
    h.setStatus({ isStreaming: false });

    h.handler.handleEvent({ type: 'agent_start' }, h.ws);

    const [first, second] = h.messages();
    expect(first.queued).toBeUndefined();
    expect(second.queued).toBe(true);
  });
});

describe('回答失败时的报错', () => {
  it('message_end 带 stopReason: error 时，把原因写到这条回答上', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(
      {
        type: 'message_end',
        message: {
          role: 'assistant',
          stopReason: 'error',
          errorMessage: 'fetch failed: ETIMEDOUT',
        },
      },
      h.ws
    );

    expect(h.messages()[0].status).toBe('error');
    expect(h.messages()[0].error).toContain('ETIMEDOUT');
  });

  it('没有 errorMessage 时给一句兜底的话，而不是空白', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(
      { type: 'message_end', message: { role: 'assistant', stopReason: 'error' } },
      h.ws
    );

    expect(h.messages()[0].error).toBeTruthy();
  });

  it('正常结束的 message_end 不写错误', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(
      { type: 'message_end', message: { role: 'assistant', stopReason: 'stop' } },
      h.ws
    );

    expect(h.messages()[0].error).toBeUndefined();
  });

  it('user 消息的 message_end 不碰当前回答', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(
      { type: 'message_end', message: { role: 'user', stopReason: 'error', errorMessage: 'x' } },
      h.ws
    );

    expect(h.messages()[0].error).toBeUndefined();
  });

  it('自动重试期间给出重试提示', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(
      { type: 'auto_retry_start', attempt: 2, maxAttempts: 3, delayMs: 2000, errorMessage: '529' },
      h.ws
    );

    expect(h.status().retrying).toEqual({ attempt: 2, maxAttempts: 3 });
  });

  it('重试成功就把提示收掉', () => {
    const h = createHarness();
    startTurn(h);
    h.handler.handleEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3 }, h.ws);

    h.handler.handleEvent({ type: 'auto_retry_end', success: true, attempt: 2 }, h.ws);

    expect(h.status().retrying).toBeUndefined();
  });

  it('重试成功后把上一次失败挂上的错误清掉（网络恢复了就不该还挂着）', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(
      {
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'Request timed out' },
      },
      h.ws
    );
    expect(h.messages()[0].error).toContain('Request timed out');

    h.handler.handleEvent({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3 }, h.ws);
    h.handler.handleEvent({ type: 'auto_retry_end', success: true, attempt: 2 }, h.ws);

    expect(h.messages()[0].error).toBeUndefined();

    // 重试拉起来的那一轮正常结束
    h.handler.handleEvent({ type: 'agent_settled' }, h.ws);
    expect(h.messages()[0].status).toBe('done');
    expect(h.messages()[0].error).toBeUndefined();
  });

  it('重试到底还是失败时，finalError 盖掉上一次的错误', () => {
    const h = createHarness();
    startTurn(h);

    h.handler.handleEvent(
      {
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'Request timed out' },
      },
      h.ws
    );
    h.handler.handleEvent({ type: 'auto_retry_start', attempt: 3, maxAttempts: 3 }, h.ws);
    h.handler.handleEvent(
      { type: 'auto_retry_end', success: false, attempt: 3, finalError: '529 overloaded_error' },
      h.ws
    );

    expect(h.messages()[0].error).toContain('overloaded');
  });

  it('重试到底还是失败时，用 finalError 报错', () => {
    const h = createHarness();
    startTurn(h);
    h.handler.handleEvent({ type: 'auto_retry_start', attempt: 3, maxAttempts: 3 }, h.ws);

    h.handler.handleEvent(
      { type: 'auto_retry_end', success: false, attempt: 3, finalError: '529 overloaded_error' },
      h.ws
    );

    expect(h.status().retrying).toBeUndefined();
    expect(h.messages()[0].error).toContain('overloaded');
  });

  it('收尾时不会把已经写上的错误冲掉', () => {
    const h = createHarness();
    startTurn(h);
    h.handler.handleEvent(
      {
        type: 'message_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'boom' },
      },
      h.ws
    );

    // pi 在 message_end 之后还会走 agent_settled，收尾不能把错误抹了
    h.handler.handleEvent({ type: 'agent_settled' }, h.ws);

    expect(h.messages()[0].status).toBe('error');
    expect(h.messages()[0].error).toBe('boom');
  });

  it('没有占位消息可写时退化成一条可见提示', () => {
    const h = createHarness();
    h.setMessages([]);
    h.handler.setCurrentAssistantId(null);

    h.handler.handleEvent(
      { type: 'auto_retry_end', success: false, attempt: 3, finalError: '连接被拒绝' },
      h.ws
    );

    expect(h.status().notice).toBe('连接被拒绝');
  });
});

describe('环境与安装事件', () => {
  it('setup_status 记下探测结果、官方命令与能否代跑', () => {
    const h = createHarness();

    h.handler.handleEvent(
      {
        type: 'setup_status',
        success: true,
        setup: { ready: false, issues: [{ code: 'pi-missing', message: '没装 pi' }] },
        installCommand: 'curl -fsSL https://pi.dev/install.sh | sh',
        preflight: { allowed: true },
      },
      h.ws
    );

    expect(h.status().setup).toMatchObject({ ready: false });
    expect(h.status().installCommand).toContain('install.sh');
    expect(h.status().preflight).toEqual({ allowed: true });
  });

  it('安装开始时清空上一次的日志与错误', () => {
    const h = createHarness();
    h.setStatus({ installLog: ['旧日志'], installError: '旧错误', installing: false });

    h.handler.handleEvent({ type: 'install_started' }, h.ws);

    expect(h.status().installing).toBe(true);
    expect(h.status().installLog).toEqual([]);
    expect(h.status().installError).toBeUndefined();
  });

  it('install_output 逐行累积', () => {
    const h = createHarness();

    h.handler.handleEvent({ type: 'install_output', line: 'Installing Pi...' }, h.ws);
    h.handler.handleEvent({ type: 'install_output', line: 'fetching (1)' }, h.ws);

    expect(h.status().installLog).toEqual(['Installing Pi...', 'fetching (1)']);
  });

  it('日志只保留最近若干行，不会无限增长', () => {
    const h = createHarness();

    for (let i = 0; i < 400; i += 1) {
      h.handler.handleEvent({ type: 'install_output', line: `第 ${i} 行` }, h.ws);
    }

    const log = h.status().installLog as string[];
    expect(log.length).toBeLessThanOrEqual(300);
    // 保留的必须是末尾那一段，否则进度会被截掉
    expect(log[log.length - 1]).toBe('第 399 行');
  });

  it('install_done 失败时留下原因，成功时不报错', () => {
    const h = createHarness();

    h.handler.handleEvent({ type: 'install_started' }, h.ws);
    h.handler.handleEvent({ type: 'install_done', ok: false, code: 1, error: '安装器以退出码 1 结束' }, h.ws);

    expect(h.status().installing).toBe(false);
    expect(h.status().installError).toContain('退出码 1');
    expect(h.status().installNotice).toBeUndefined();
  });

  it('install_done 成功但带说明时不算错误，只留一句看得见的提示', () => {
    // 官方安装器的收尾步骤失败会把「装好了」报成非零退出码；
    // 桥接改用探测结果判成功，但退出码不能就这么丢掉
    const h = createHarness();

    h.handler.handleEvent({ type: 'install_started' }, h.ws);
    h.handler.handleEvent(
      {
        type: 'install_done',
        ok: true,
        code: 1,
        notice: '安装器以退出码 1 结束，但 pi 已经装好并可用。',
      },
      h.ws
    );

    expect(h.status().installing).toBe(false);
    expect(h.status().installError).toBeUndefined();
    expect(h.status().installNotice).toContain('已经装好并可用');
  });

  it('重新开始安装时清掉上一次的提示，不把旧结论留在页面上', () => {
    const h = createHarness();

    h.handler.handleEvent({ type: 'install_done', ok: true, code: 1, notice: '旧提示' }, h.ws);
    h.handler.handleEvent({ type: 'install_started' }, h.ws);

    expect(h.status().installNotice).toBeUndefined();
  });

  it('install_refused 把拒绝原因显示出来，而不是点了没反应', () => {
    const h = createHarness();

    h.handler.handleEvent({ type: 'install_refused', error: 'Node.js 版本不够' }, h.ws);

    expect(h.status().installing).toBe(false);
    expect(h.status().installError).toContain('Node.js 版本不够');
  });
});

describe('供应商配置事件', () => {
  it('setup_status 带上供应商目录与订阅入口', () => {
    const h = createHarness();

    h.handler.handleEvent(
      {
        type: 'setup_status',
        success: true,
        setup: { ready: false, issues: [] },
        providers: [{ id: 'anthropic', label: 'Anthropic (Claude)', envVar: 'ANTHROPIC_API_KEY' }],
        subscriptions: [{ id: 'openai', label: 'ChatGPT Plus/Pro (Codex)' }],
      },
      h.ws
    );

    expect(h.status().providers[0].id).toBe('anthropic');
    expect(h.status().subscriptions[0].label).toContain('ChatGPT');
  });

  it('setup_status 记下用户起的供应商名（否则界面永远看不到它）', () => {
    const h = createHarness();

    h.handler.handleEvent(
      {
        type: 'setup_status',
        success: true,
        setup: { ready: true, issues: [] },
        providerNames: { deepseek: '我的中转站' },
      },
      h.ws
    );

    expect(h.status().providerNames).toEqual({ deepseek: '我的中转站' });
  });

  it('setup_status 记下各供应商的中转地址，供表单回显', () => {
    const h = createHarness();

    h.handler.handleEvent(
      {
        type: 'setup_status',
        success: true,
        setup: { ready: true, issues: [] },
        providerBaseUrls: { deepseek: 'https://relay.example/v1' },
      },
      h.ws
    );

    expect(h.status().providerBaseUrls).toEqual({ deepseek: 'https://relay.example/v1' });
  });

  it('setup_status 记下哪些供应商能删（auth.json 里的那些）', () => {
    const h = createHarness();

    h.handler.handleEvent(
      {
        type: 'setup_status',
        success: true,
        setup: { ready: true, issues: [] },
        deletableProviders: ['deepseek'],
      },
      h.ws
    );

    expect(h.status().deletableProviders).toEqual(['deepseek']);
  });

  it('删除供应商失败时留下原因', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'provider_deleted', success: false, error: 'auth.json 不是合法的 JSON' },
      h.ws
    );

    expect(h.status().setupNotice).toContain('auth.json');
  });

  it('后续 setup_status 没带 providerNames 时保留上一次的', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'setup_status', success: true, setup: { ready: true, issues: [] }, providerNames: { deepseek: '我的中转站' } },
      h.ws
    );
    h.handler.handleEvent(
      { type: 'setup_status', success: true, setup: { ready: true, issues: [] } },
      h.ws
    );

    expect(h.status().providerNames).toEqual({ deepseek: '我的中转站' });
  });

  it('保存失败时留下原因，成功时清掉', () => {
    const h = createHarness();

    h.handler.handleEvent({ type: 'provider_saved', success: false, error: 'API key 不能为空' }, h.ws);
    expect(h.status().setupNotice).toBe('API key 不能为空');

    h.handler.handleEvent({ type: 'provider_saved', success: true, provider: 'anthropic' }, h.ws);
    expect(h.status().setupNotice).toBeUndefined();
  });

  it('保存成功时不把 key 带进状态', () => {
    const h = createHarness();

    // 桥接本来就不回声 key，这里锁住「前端也不该出现它」
    h.handler.handleEvent(
      { type: 'provider_saved', success: true, provider: 'anthropic', key: 'sk-should-not-leak' },
      h.ws
    );

    expect(JSON.stringify(h.status())).not.toContain('sk-should-not-leak');
  });
});

describe('上下文压缩', () => {
  it('compaction_start 进入「压缩中」', () => {
    const h = createHarness();

    h.handler.handleEvent({ type: 'compaction_start', reason: 'manual' }, h.ws);

    expect(h.status().compacting).toBe(true);
  });

  it('压缩成功：退出压缩中，给出前后对比，并重取用量', () => {
    const h = createHarness();
    h.handler.handleEvent({ type: 'compaction_start', reason: 'manual' }, h.ws);

    h.handler.handleEvent(
      {
        type: 'compaction_end',
        reason: 'manual',
        aborted: false,
        willRetry: false,
        result: { tokensBefore: 150000, estimatedTokensAfter: 32000 },
      },
      h.ws
    );

    expect(h.status().compacting).toBe(false);
    expect(h.status().compactionNotice).toContain('150');
    expect(h.status().compactionNotice).toContain('32');

    const sent = h.ws.sent.map(raw => JSON.parse(raw));
    expect(sent.some(m => m.type === 'get_session_stats')).toBe(true);
    expect(sent.some(m => m.type === 'get_state')).toBe(true);
  });

  it('压缩被取消：说明是取消了，不当成失败', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'compaction_end', reason: 'manual', aborted: true, result: null },
      h.ws
    );

    expect(h.status().compacting).toBe(false);
    expect(h.status().compactionNotice).toContain('取消');
  });

  it('压缩失败：把原因带出来', () => {
    const h = createHarness();

    h.handler.handleEvent(
      {
        type: 'compaction_end',
        reason: 'overflow',
        aborted: false,
        result: null,
        errorMessage: 'quota exceeded',
      },
      h.ws
    );

    expect(h.status().compactionNotice).toContain('quota exceeded');
  });

  it('get_state 里的 isCompacting 也能进入「压缩中」（自动压缩时界面要知道）', () => {
    const h = createHarness();

    h.handler.handleEvent(
      { type: 'response', command: 'get_state', success: true, data: { isCompacting: true } },
      h.ws
    );

    expect(h.status().compacting).toBe(true);
  });
});
