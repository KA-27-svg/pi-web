// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiMessage } from '../types/pi';
import { PiMessageItem } from './PiMessageItem';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const render = (message: PiMessage) => {
  act(() => {
    root.render(<PiMessageItem message={message} />);
  });
};

const hasEnterAnimation = () => host.querySelector('.paper-in') !== null;

const message = (over: Partial<PiMessage> = {}): PiMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '正文',
  timestamp: 1,
  status: 'done',
  ...over,
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('入场动画', () => {
  it('刚刚产生的消息才播动画', () => {
    render(message());

    expect(hasEnterAnimation()).toBe(true);
  });

  it('切换会话 / 重连恢复出来的历史不播动画', () => {
    // 从会话记录恢复的整段对话如果播动画，看起来就像对话被重新加载了一遍
    render(message({ fromHistory: true }));

    expect(hasEnterAnimation()).toBe(false);
  });

  it('用户消息同样遵循这条规则', () => {
    render(message({ role: 'user', fromHistory: true }));
    expect(hasEnterAnimation()).toBe(false);

    render(message({ role: 'user' }));
    expect(hasEnterAnimation()).toBe(true);
  });
});

describe('用户消息里的附件', () => {
  const user = (over: Partial<PiMessage> = {}) =>
    message({ role: 'user', content: '', ...over });

  it('图片直接渲染成图片，而不是文件名', () => {
    render(
      user({
        attachments: [
          { kind: 'image', name: '图片 1', dataUrl: 'data:image/png;base64,QUJD' },
        ],
      })
    );

    const img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  });

  it('文件渲染成卡片，带文件名与路径提示', () => {
    render(
      user({
        attachments: [
          { kind: 'file', name: '报告.docx', path: '.pi-web-uploads/报告.docx' },
        ],
      })
    );

    const card = host.querySelector('[title=".pi-web-uploads/报告.docx"]');
    expect(card?.textContent).toContain('报告.docx');
    expect(host.querySelector('img')).toBeNull();
  });

  it('图片和文件同时存在时两者都渲染', () => {
    render(
      user({
        content: '一起看',
        attachments: [
          { kind: 'image', name: '图片 1', dataUrl: 'data:image/png;base64,QUJD' },
          { kind: 'file', name: 'a.txt', path: '.pi-web-uploads/a.txt' },
        ],
      })
    );

    expect(host.querySelector('img')).not.toBeNull();
    expect(host.textContent).toContain('a.txt');
    expect(host.textContent).toContain('一起看');
  });

  it('只有附件、没有正文时不渲染空气泡', () => {
    render(
      user({
        attachments: [{ kind: 'image', name: '图片 1', dataUrl: 'data:image/png;base64,QUJD' }],
      })
    );

    expect(host.textContent?.trim()).toBe('');
    expect(host.querySelector('img')).not.toBeNull();
  });
});
