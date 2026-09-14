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
