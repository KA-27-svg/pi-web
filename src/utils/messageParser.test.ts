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

  it('ID 由索引派生，重复解析结果完全一致', () => {
    const raw = [
      user('一'),
      { role: 'assistant', content: 'a', timestamp: 1 },
      user('二'),
      { role: 'assistant', content: 'b', timestamp: 2 },
    ];

    const first = MessageParser.parseHistory(raw);
    const second = MessageParser.parseHistory(raw);

    expect(first.map(m => m.id)).toEqual(second.map(m => m.id));
    // 索引稳定：第三条（index 2）的 id 不能因为前面被过滤而前移
    expect(first.map(m => m.id)).toEqual(['hist-user-0', 'hist-asst-1', 'hist-user-2', 'hist-asst-3']);
  });

  it('被过滤的消息不占用后续 id，保证刷新不会导致重新挂载', () => {
    const bashWrapper = 'Ran `ls`\n```\noutput\n```';
    const parsed = MessageParser.parseHistory([
      user(bashWrapper),
      { role: 'assistant', content: '看到了', timestamp: 1 },
    ]);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('hist-asst-1');
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
});
