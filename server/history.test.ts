import { describe, expect, it } from 'vitest';
import { branchEntries, historyMessages } from './history';

/** 造一条最简单的会话条目；只写测试关心的字段 */
function msg(id: string, parentId: string | null, role: string, text = id) {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: `2026-09-19T00:00:00.000Z`,
    message: { role, content: [{ type: 'text', text }], timestamp: 1 },
  };
}

function compaction(id: string, parentId: string, firstKeptEntryId: string, summary: string) {
  return {
    type: 'compaction',
    id,
    parentId,
    timestamp: '2026-09-19T01:00:00.000Z',
    firstKeptEntryId,
    tokensBefore: 1234,
    summary,
  };
}

describe('branchEntries', () => {
  it('从叶子沿 parentId 回溯，返回时间顺序的当前分支', () => {
    const entries = [msg('a', null, 'user'), msg('b', 'a', 'assistant'), msg('c', 'b', 'user')];

    expect(branchEntries(entries, 'c').map(e => e.id)).toEqual(['a', 'b', 'c']);
    // 从中间那条回溯，后面那条不算
    expect(branchEntries(entries, 'b').map(e => e.id)).toEqual(['a', 'b']);
  });

  it('丢掉被分叉抛弃的那一支', () => {
    const entries = [
      msg('a', null, 'user'),
      msg('b', 'a', 'assistant'),
      msg('x', 'a', 'user'), // 旧分支
      msg('c', 'b', 'user'), // 当前分支
    ];

    expect(branchEntries(entries, 'c').map(e => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('认不出叶子时原样返回（宁多勿少）', () => {
    const entries = [msg('a', null, 'user')];

    expect(branchEntries(entries, '不存在').map(e => e.id)).toEqual(['a']);
    expect(branchEntries(entries, undefined).map(e => e.id)).toEqual(['a']);
  });
});

describe('historyMessages', () => {
  it('把 message 条目摊平成消息，跳过别的条目', () => {
    const entries = [
      msg('a', null, 'user', '你好'),
      { type: 'model_change', id: 'm', parentId: 'a', provider: 'x', modelId: 'y' },
      msg('b', 'a', 'assistant', '在'),
    ];

    const messages = historyMessages(entries, 'b');

    expect(messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[0].content[0].text).toBe('你好');
  });

  it('压缩摘要落在它保留的第一条之前，而不是文件里那条 compaction 的位置', () => {
    // 文件顺序：老消息…保留的那条…compaction 记在最后
    const entries = [
      msg('a', null, 'user', '被压掉的'),
      msg('b', 'a', 'assistant', '被压掉的回答'),
      msg('c', 'b', 'user', '保留的'),
      compaction('k', 'c', 'c', '摘要正文'),
      msg('d', 'k', 'assistant', '之后的'),
    ];

    const messages = historyMessages(entries, 'd');

    expect(messages.map((m: any) => m.role)).toEqual([
      'user',
      'assistant',
      'compactionSummary',
      'user',
      'assistant',
    ]);
    const marker = messages[2] as any;
    expect(marker.summary).toBe('摘要正文');
    expect(marker.tokensBefore).toBe(1234);
  });

  it('多次压缩各自落在自己的边界上', () => {
    const entries = [
      msg('a', null, 'user'),
      compaction('k1', 'a', 'a', '第一次'),
      msg('b', 'k1', 'user'),
      compaction('k2', 'b', 'b', '第二次'),
      msg('c', 'k2', 'assistant'),
    ];

    const messages = historyMessages(entries, 'c');

    expect(messages.map((m: any) => (m.role === 'compactionSummary' ? m.summary : m.role))).toEqual(
      ['第一次', 'user', '第二次', 'user', 'assistant']
    );
  });

  it('边界条目不在分支上时，摘要退回到它自己的位置，不丢', () => {
    const entries = [msg('a', null, 'user'), compaction('k', 'a', '别的分支上的条目', '摘要')];

    // 叶子就是那条压缩记录本身：分界条目不在分支上
    const messages = historyMessages(entries, 'k');

    expect(messages.map((m: any) => m.role)).toEqual(['user', 'compactionSummary']);
  });

  it('把还在流式生成的那条补在末尾（它还没进会话文件）', () => {
    const entries = [msg('a', null, 'user')];
    const live = [{ role: 'assistant', content: [{ type: 'text', text: '半句' }], timestamp: 9 }];

    const messages = historyMessages(entries, 'a', live);

    expect(messages.map((m: any) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1]).toBe(live[0]);
  });

  it('文件里已经有的那条不重复补一遍', () => {
    const entries = [msg('a', null, 'user')];
    const last = { role: 'user', content: [{ type: 'text', text: 'a' }], timestamp: 1 };

    expect(historyMessages(entries, 'a', [last])).toHaveLength(1);
  });

  it('空会话给空数组', () => {
    expect(historyMessages([], undefined)).toEqual([]);
  });
});
