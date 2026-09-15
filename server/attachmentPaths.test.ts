import { describe, expect, it } from 'vitest';
import { attachmentPathsInMessages, attachmentPathsInText } from './attachmentPaths';

describe('attachmentPathsInText', () => {
  it('取出一行一个的附件路径', () => {
    expect(
      attachmentPathsInText('[附件] C:/Users/me/a.docx\n[附件] .pi-web-uploads/b.pdf\n\n看看这两个')
    ).toEqual(['C:/Users/me/a.docx', '.pi-web-uploads/b.pdf']);
  });

  it('普通消息里没有附件行', () => {
    expect(attachmentPathsInText('这是普通消息\n第二行')).toEqual([]);
  });

  it('只是碰巧提到「附件」两个字的行不算', () => {
    expect(attachmentPathsInText('我说的附件 是这个词')).toEqual([]);
  });

  it('空路径行忽略', () => {
    expect(attachmentPathsInText('[附件]   \n[附件] real.txt')).toEqual(['real.txt']);
  });
});

describe('attachmentPathsInMessages', () => {
  const getMessages = (messages: unknown[]) => messages;

  it('从用户消息里挖出路径', () => {
    const messages = getMessages([
      { role: 'user', content: '[附件] C:/Users/me/OneDrive/文档/报告.docx\n\n帮我看看' },
      { role: 'assistant', content: [{ type: 'text', text: '好的' }] },
    ]);

    expect(attachmentPathsInMessages(messages)).toEqual(['C:/Users/me/OneDrive/文档/报告.docx']);
  });

  it('内容是数组时同样能挖出来', () => {
    const messages = getMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: '[附件] C:/a.docx' },
          { type: 'image', data: 'x', mimeType: 'image/png' },
        ],
      },
    ]);

    expect(attachmentPathsInMessages(messages)).toEqual(['C:/a.docx']);
  });

  it('只看用户消息——助理的输出可能被提示注入影响', () => {
    const messages = getMessages([
      { role: 'assistant', content: '[附件] C:/Windows/System32/calc.exe' },
      { role: 'toolResult', content: [{ type: 'text', text: '[附件] C:/evil.exe' }] },
    ]);

    expect(attachmentPathsInMessages(messages)).toEqual([]);
  });

  it('同一条路径重复出现只算一次', () => {
    const messages = getMessages([
      { role: 'user', content: '[附件] C:/a.docx' },
      { role: 'user', content: '再看一次\n[附件] C:/a.docx' },
    ]);

    expect(attachmentPathsInMessages(messages)).toEqual(['C:/a.docx']);
  });

  it('内容结构不对时不抛错', () => {
    expect(attachmentPathsInMessages(null)).toEqual([]);
    expect(attachmentPathsInMessages('不是数组')).toEqual([]);
    expect(attachmentPathsInMessages([null, 42, { role: 'user' }])).toEqual([]);
  });
});
