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
