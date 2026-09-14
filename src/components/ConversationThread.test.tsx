// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiMessage } from '../types/pi';
import { ConversationThread } from './ConversationThread';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const message = (id: string, content: string): PiMessage => ({
  id,
  role: 'assistant',
  content,
  timestamp: 1,
  status: 'done',
  fromHistory: true,
});

const render = (messages: PiMessage[], switching = false) => {
  act(() => {
    root.render(
      <ConversationThread
        messages={messages}
        switching={switching}
        contentRef={createRef<HTMLDivElement>()}
        endRef={createRef<HTMLDivElement>()}
      />
    );
  });
};

const wrapper = () => host.querySelector('.max-w-content') as HTMLElement | null;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('ConversationThread', () => {
  it('没有消息时不渲染容器', () => {
    render([]);
    expect(wrapper()).toBeNull();
  });

  it('正常状态下显示对话内容', () => {
    render([message('a', '上一个会话')]);

    expect(wrapper()?.className).not.toContain('invisible');
    expect(wrapper()?.textContent).toContain('上一个会话');
  });

  it('切换会话时隐藏内容，但仍留在 DOM 里以保持布局', () => {
    // 关键：不能靠不渲染来隐藏——那会让高度塌陷，
    // 底部输入区位置与滚动位置都会跟着弹一次
    render([message('a', '上一个会话')], true);

    expect(wrapper()?.className).toContain('invisible');
    expect(wrapper()?.textContent).toContain('上一个会话');
    expect(wrapper()?.children.length).toBeGreaterThan(0);
  });

  it('切换结束后内容直接换成新的', () => {
    render([message('a', '上一个会话')], true);
    render([message('b', '新会话')]);

    expect(wrapper()?.className).not.toContain('invisible');
    expect(wrapper()?.textContent).toContain('新会话');
    expect(wrapper()?.textContent).not.toContain('上一个会话');
  });
});
