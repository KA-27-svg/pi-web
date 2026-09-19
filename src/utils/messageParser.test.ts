import { describe, expect, it } from 'vitest';
import { MessageParser } from './messageParser';

const user = (content: unknown, timestamp = 1000) => ({ role: 'user', content, timestamp });

describe('MessageParser.parseHistory', () => {
  it('解析用户文本与助手的内容块', () => {
    const parsed = MessageParser.parseHistory([
      user('你好'),
      {
        role: 'assistant',
        timestamp: 2000,
        content: [
          { type: 'thinking', thinking: '先想想' },
          { type: 'text', text: '回答如下' },
          { type: 'toolCall', id: 'call-1', name: 'bash', arguments: { command: 'ls' } },
        ],
      },
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ role: 'user', content: '你好', status: 'done', timestamp: 1000 });
    expect(parsed[1]).toMatchObject({
      role: 'assistant',
      content: '回答如下',
      reasoning: '先想想',
      status: 'done',
    });
    expect(parsed[1].tools).toEqual([
      { id: 'call-1', name: 'bash', args: { command: 'ls' }, status: 'done' },
    ]);
  });

  it('助手 content 为字符串时直接作为正文', () => {
    const parsed = MessageParser.parseHistory([{ role: 'assistant', content: '纯文本', timestamp: 5 }]);
    expect(parsed[0]).toMatchObject({ content: '纯文本', reasoning: '' });
  });

  it('用户 content 为内容块数组时拼接文本', () => {
    const parsed = MessageParser.parseHistory([user([{ type: 'text', text: '第一段' }, { type: 'text', text: '第二段' }])]);
    expect(parsed[0].content).toBe('第一段\n第二段');
  });

  it('每次加载给一批新 id，避免不同会话共用组件状态', () => {
    const raw = [user('一'), { role: 'assistant', content: 'a', timestamp: 1 }];

    const first = MessageParser.parseHistory(raw);
    const second = MessageParser.parseHistory(raw);

    // 同一个下标上的思考块展开状态不应该从一个会话串到另一个会话，
    // 所以每次加载都换一批 id；重播动画另由 fromHistory 抑制
    expect(first.map(m => m.id)).not.toEqual(second.map(m => m.id));
    // 同一批内仍然按索引区分，后缀可读
    expect(first[0].id).toMatch(/-user-0$/);
    expect(first[1].id).toMatch(/-asst-1$/);
  });

  it('被过滤的消息仍然占用索引，同一批内下标不会前移', () => {
    const bashWrapper = 'Ran `ls`\n```\noutput\n```';
    const parsed = MessageParser.parseHistory([
      user(bashWrapper),
      { role: 'assistant', content: '看到了', timestamp: 1 },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toMatch(/-asst-1$/);
  });

  it('恢复出来的消息都标记为历史，以免重播入场动画', () => {
    const parsed = MessageParser.parseHistory([
      user('问'),
      { role: 'assistant', content: '答', timestamp: 1 },
    ]);

    expect(parsed.every(m => m.fromHistory === true)).toBe(true);
  });

  it('过滤 bash 调试包装消息', () => {
    const parsed = MessageParser.parseHistory([user('Ran `git status`\n```\nclean\n```')]);
    expect(parsed).toEqual([]);
  });

  it('保留以 Ran 开头但没有代码块的普通消息', () => {
    const parsed = MessageParser.parseHistory([user('Ran out of ideas')]);
    expect(parsed).toHaveLength(1);
  });

  it('忽略既非 user 也非 assistant 的角色', () => {
    const parsed = MessageParser.parseHistory([
      user('问题'),
      { role: 'toolResult', content: [{ type: 'text', text: '结果' }] },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].role).toBe('user');
  });

  it('把 toolResult 挂回对应的工具调用（刷新 / 切会话后结果不能丢）', () => {
    const parsed = MessageParser.parseHistory([
      {
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }],
      },
      {
        role: 'toolResult',
        toolCallId: 'c1',
        toolName: 'bash',
        content: [{ type: 'text', text: 'a.ts\nb.ts' }],
        isError: false,
        timestamp: 2,
      },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].tools).toEqual([
      { id: 'c1', name: 'bash', args: { command: 'ls' }, status: 'done', result: 'a.ts\nb.ts' },
    ]);
  });

  it('出错的 toolResult 标成 error', () => {
    const parsed = MessageParser.parseHistory([
      {
        role: 'assistant',
        timestamp: 1,
        content: [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: {} }],
      },
      {
        role: 'toolResult',
        toolCallId: 'c1',
        content: [{ type: 'text', text: '命令失败' }],
        isError: true,
        timestamp: 2,
      },
    ]);

    expect(parsed[0].tools?.[0].status).toBe('error');
    expect(parsed[0].tools?.[0].result).toBe('命令失败');
  });

  it('助手有工具调用但无文本时仍保留 tools', () => {
    const parsed = MessageParser.parseHistory([
      { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'c1', name: 'write', arguments: { path: 'a.ts' } }] },
    ]);
    expect(parsed[0].content).toBe('');
    expect(parsed[0].tools).toEqual([{ id: 'c1', name: 'write', args: { path: 'a.ts' }, status: 'done' }]);
  });

  it('空输入返回空数组', () => {
    expect(MessageParser.parseHistory([])).toEqual([]);
  });

  it('没有附件的消息不挂 attachments 字段', () => {
    const parsed = MessageParser.parseHistory([user('普通消息')]);
    expect(parsed[0].attachments).toBeUndefined();
  });
});

describe('历史里的附件', () => {
  it('图片块还原成 data URL', () => {
    const parsed = MessageParser.parseHistory([
      user([
        { type: 'text', text: '这是啥' },
        { type: 'image', data: 'QUJD', mimeType: 'image/png' },
      ]),
    ]);

    expect(parsed[0].content).toBe('这是啥');
    expect(parsed[0].attachments).toEqual([
      { kind: 'image', name: '图片 1', dataUrl: 'data:image/png;base64,QUJD' },
    ]);
  });

  it('多张图按顺序编号', () => {
    const parsed = MessageParser.parseHistory([
      user([
        { type: 'image', data: 'QQ==', mimeType: 'image/png' },
        { type: 'image', data: 'Qg==', mimeType: 'image/jpeg' },
      ]),
    ]);

    expect(parsed[0].attachments?.map(a => a.dataUrl)).toEqual([
      'data:image/png;base64,QQ==',
      'data:image/jpeg;base64,Qg==',
    ]);
  });

  it('文件路径从正文里变成文件卡片', () => {
    const parsed = MessageParser.parseHistory([
      user('[附件] .pi-web-uploads/报告.docx\n\n帮我总结'),
    ]);

    expect(parsed[0].content).toBe('帮我总结');
    expect(parsed[0].attachments).toEqual([
      { kind: 'file', name: '报告.docx', path: '.pi-web-uploads/报告.docx' },
    ]);
  });

  it('图片与文件同时存在时先图片后文件', () => {
    const parsed = MessageParser.parseHistory([
      user([
        { type: 'text', text: '[附件] .pi-web-uploads/a.txt\n\n一起看' },
        { type: 'image', data: 'QUJD', mimeType: 'image/png' },
      ]),
    ]);

    expect(parsed[0].content).toBe('一起看');
    expect(parsed[0].attachments?.map(a => a.kind)).toEqual(['image', 'file']);
  });

  it('内容被内联进消息的文本附件，仍然渲染成文件卡片而不是一大块代码', () => {
    // 不处理的话，刷新页面后气泡里会直接铺开文件内容
    const parsed = MessageParser.parseHistory([
      user('[附件] src/a.ts\n```\nexport const a = 1;\n```\n\n看看这个'),
    ]);

    expect(parsed[0].content).toBe('看看这个');
    expect(parsed[0].attachments).toEqual([
      { kind: 'file', name: 'a.ts', path: 'src/a.ts' },
    ]);
  });

  it('只发附件时正文为空，不把自动补的提示句漏出来', () => {
    const parsed = MessageParser.parseHistory([
      user('[附件] .pi-web-uploads/a.docx\n\n（请读取以上附件）'),
    ]);

    expect(parsed[0].content).toBe('');
    expect(parsed[0].attachments).toHaveLength(1);
  });

  it('内容为空的图片块不会弹出空白图', () => {
    const parsed = MessageParser.parseHistory([
      user([{ type: 'image', mimeType: 'image/png' }]),
    ]);

    expect(parsed[0].attachments).toBeUndefined();
  });
});

describe('模型还原', () => {
  it('assistant 消息带出 model，界面才知道这条是谁答的', () => {
    const parsed = MessageParser.parseHistory([
      {
        role: 'assistant',
        content: [{ type: 'text', text: '答' }],
        model: 'claude-sonnet-4',
        timestamp: 1,
      },
    ]);

    expect(parsed[0].model).toBe('claude-sonnet-4');
  });

  it('老消息没有 model 时不硬塞一个', () => {
    const parsed = MessageParser.parseHistory([
      { role: 'assistant', content: '答', timestamp: 1 },
    ]);

    expect(parsed[0].model).toBeUndefined();
  });
});

describe('同一回合的消息合并（实时是这样，历史不能拆成一堆）', () => {
  it('多条 assistant 合成一条：正文、思考、工具都累加，toolResult 照样挂回', () => {
    const parsed = MessageParser.parseHistory([
      user('问题'),
      {
        role: 'assistant',
        timestamp: 2000,
        content: [
          { type: 'thinking', thinking: '先想' },
          { type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } },
        ],
      },
      { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: 'a.ts' }], timestamp: 2100 },
      {
        role: 'assistant',
        timestamp: 2200,
        content: [{ type: 'toolCall', id: 'c2', name: 'read', arguments: { path: 'a.ts' } }],
      },
      { role: 'toolResult', toolCallId: 'c2', content: [{ type: 'text', text: '文件内容' }], timestamp: 2300 },
      { role: 'assistant', timestamp: 2400, model: 'deepseek', content: [{ type: 'text', text: '好了' }] },
    ]);

    // user + 一条合并后的 assistant
    expect(parsed).toHaveLength(2);
    expect(parsed[1].content).toBe('好了');
    expect(parsed[1].reasoning).toBe('先想');
    expect(parsed[1].tools?.map(t => t.id)).toEqual(['c1', 'c2']);
    expect(parsed[1].tools?.[0].result).toBe('a.ts');
    expect(parsed[1].tools?.[1].result).toBe('文件内容');
    expect(parsed[1].model).toBe('deepseek');
    expect(parsed[1].timestamp).toBe(2400);
  });

  it('用户消息断开回合，不跨回合合并', () => {
    const parsed = MessageParser.parseHistory([
      user('一'),
      { role: 'assistant', content: 'a1', timestamp: 1 },
      { role: 'assistant', content: 'a2', timestamp: 2 },
      user('二'),
      { role: 'assistant', content: 'b1', timestamp: 3 },
    ]);

    expect(parsed.map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(parsed[1].content).toBe('a1\n\na2');
    expect(parsed[3].content).toBe('b1');
  });

  it('只有一步操作时也还是原来的样子', () => {
    const parsed = MessageParser.parseHistory([
      user('问题'),
      { role: 'assistant', content: '答', timestamp: 5 },
    ]);

    expect(parsed).toHaveLength(2);
    expect(parsed[1].content).toBe('答');
  });
});

describe('压缩摘要（自动压缩后的历史回看）', () => {
  const summary = {
    role: 'compactionSummary',
    summary: '上面聊了 X、Y、Z',
    tokensBefore: 112416,
    timestamp: 1700000000000,
  };

  it('摘要变成一条独立的分隔，正文是摘要原文', () => {
    const parsed = MessageParser.parseHistory([user('问题'), summary]);

    expect(parsed.map(m => m.role)).toEqual(['user', 'compaction']);
    expect(parsed[1]).toMatchObject({
      role: 'compaction',
      content: '上面聊了 X、Y、Z',
      tokensBefore: 112416,
      timestamp: 1700000000000,
      status: 'done',
      fromHistory: true,
    });
  });

  it('摘要断开回合：压缩前后的 assistant 不能并成一条', () => {
    const parsed = MessageParser.parseHistory([
      user('问题'),
      { role: 'assistant', content: '压缩前', timestamp: 1 },
      summary,
      { role: 'assistant', content: '压缩后', timestamp: 2 },
    ]);

    expect(parsed.map(m => m.role)).toEqual(['user', 'assistant', 'compaction', 'assistant']);
    expect(parsed[1].content).toBe('压缩前');
    expect(parsed[3].content).toBe('压缩后');
  });
});
