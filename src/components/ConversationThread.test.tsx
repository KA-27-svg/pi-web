// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiMessage } from '../types/pi';
import { ConversationThread } from './ConversationThread';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 收集组件注册的 IntersectionObserver 回调，用来手动触发「滚到顶」 */
const observerCallbacks: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];

/** 组件要求确实存在一个滚动容器才会注册观察器，所以给个真实元素 */
const scrollRef = { current: null as HTMLElement | null };

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

interface Options {
  switching?: boolean;
  hasEarlier?: boolean;
  onLoadEarlier?: () => void;
}

const render = (messages: PiMessage[], options: Options = {}) => {
  act(() => {
    root.render(
      <ConversationThread
        messages={messages}
        switching={options.switching}
        hasEarlier={options.hasEarlier}
        onLoadEarlier={options.onLoadEarlier}
        scrollRef={scrollRef}
        contentRef={createRef<HTMLDivElement>()}
        endRef={createRef<HTMLDivElement>()}
      />
    );
  });
};

const wrapper = () => host.querySelector('.max-w-content') as HTMLElement | null;
const earlierHint = () => host.querySelector('.text-center');

/** 模拟顶部 sentinel 进入 / 离开视口 */
const intersect = (isIntersecting: boolean) => {
  act(() => {
    for (const callback of observerCallbacks) callback([{ isIntersecting }]);
  });
};

beforeEach(() => {
  observerCallbacks.length = 0;
  scrollRef.current = document.createElement('div');
  class IntersectionObserverStub {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      observerCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver =
    IntersectionObserverStub;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('渲染与切换', () => {
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
    render([message('a', '上一个会话')], { switching: true });

    expect(wrapper()?.className).toContain('invisible');
    expect(wrapper()?.textContent).toContain('上一个会话');
    expect(wrapper()?.children.length).toBeGreaterThan(0);
  });

  it('切换结束后内容直接换成新的', () => {
    render([message('a', '上一个会话')], { switching: true });
    render([message('b', '新会话')]);

    expect(wrapper()?.className).not.toContain('invisible');
    expect(wrapper()?.textContent).toContain('新会话');
    expect(wrapper()?.textContent).not.toContain('上一个会话');
  });
});

describe('向上加载更早的消息', () => {
  it('还有更早的消息时给出提示与哨兵', () => {
    render([message('a', '窗口内')], { hasEarlier: true });
    expect(earlierHint()?.textContent).toContain('向上滚动加载更早的消息');
  });

  it('全都在窗口内时不出提示', () => {
    render([message('a', '窗口内')], { hasEarlier: false });
    expect(earlierHint()).toBeNull();
  });

  it('哨兵进入视口时请求补一页', () => {
    const onLoadEarlier = vi.fn();
    render([message('a', '窗口内')], { hasEarlier: true, onLoadEarlier });

    intersect(true);

    expect(onLoadEarlier).toHaveBeenCalledTimes(1);
  });

  it('哨兵不在视口时不请求', () => {
    const onLoadEarlier = vi.fn();
    render([message('a', '窗口内')], { hasEarlier: true, onLoadEarlier });

    intersect(false);

    expect(onLoadEarlier).not.toHaveBeenCalled();
  });

  it('没有更早的消息时不注册观察器', () => {
    render([message('a', '窗口内')], { hasEarlier: false, onLoadEarlier: vi.fn() });
    expect(observerCallbacks).toHaveLength(0);
  });
});
