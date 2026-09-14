// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, SessionSummary } from '../types/pi';
import { Sidebar } from './Sidebar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 侧栏使用 hook 的默认松手延迟，这里等得宽松一些，不与具体默认值耦合
const WELL_AFTER_RELEASE = 1000;

const session = (index: number): SessionSummary => ({
  path: `/tmp/proj/session-${index}.jsonl`,
  id: `id-${index}`,
  preview: `对话 ${index}`,
  updatedAt: Date.now(),
  cwd: 'C:\\demo',
});

const status = (count: number): BridgeStatus => ({
  connected: true,
  cwd: 'C:\\demo',
  isStreaming: false,
  sessions: Array.from({ length: count }, (_, i) => session(i)),
});

const noop = () => {};

let root: Root;
let host: HTMLElement;

const mount = (count: number) => {
  act(() => {
    root.render(
      <Sidebar
        open
        status={status(count)}
        onToggle={noop}
        onNewSession={noop}
        onSwitchSession={noop}
        onRenameSession={noop}
        onDeleteSession={noop}
        onRefreshSessions={noop}
      />
    );
  });
};

const setMetrics = (
  el: HTMLElement,
  metrics: { scrollTop?: number; scrollHeight?: number; clientHeight?: number }
) => {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(el, key, { configurable: true, writable: true, value });
  }
};

const dispatchWheel = (target: EventTarget, deltaY: number) => {
  const event = new Event('wheel', { bubbles: true, cancelable: true }) as Event & {
    deltaY: number;
    deltaMode: number;
  };
  event.deltaY = deltaY;
  event.deltaMode = 0;
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const nav = () => host.querySelector('nav') as HTMLElement;
const list = () => host.querySelector('nav ul') as HTMLElement;
const listTransform = () => list().style.transform;

describe('历史对话侧栏', () => {
  it('滚动容器带常驻可见滚动条的样式类', () => {
    mount(3);
    expect(nav().className).toContain('scroll-visible');
  });

  it('隐藏时不渲染会话条目', () => {
    act(() => {
      root.render(
        <Sidebar
          open={false}
          status={status(3)}
          onToggle={noop}
          onNewSession={noop}
          onSwitchSession={noop}
          onRenameSession={noop}
          onDeleteSession={noop}
          onRefreshSessions={noop}
        />
      );
    });
    expect(host.querySelector('aside')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('滚到列表底部后继续下滚会拉出位移并可回弹', () => {
    mount(20);
    setMetrics(nav(), { scrollTop: 400, scrollHeight: 900, clientHeight: 500 });

    const event = dispatchWheel(list(), 100);

    expect(event.defaultPrevented).toBe(true);
    expect(listTransform()).toMatch(/translateY\(-\d/);
  });

  it('列表未到底时不接管，交还原生滚动', () => {
    mount(20);
    setMetrics(nav(), { scrollTop: 100, scrollHeight: 900, clientHeight: 500 });

    const event = dispatchWheel(list(), 100);

    expect(event.defaultPrevented).toBe(false);
    expect(listTransform()).toBe('');
  });

  it('松手后回弹到原位', () => {
    vi.useFakeTimers();
    mount(20);
    setMetrics(nav(), { scrollTop: 400, scrollHeight: 900, clientHeight: 500 });

    dispatchWheel(list(), 100);
    expect(listTransform()).toMatch(/translateY\(-\d/);

    act(() => {
      vi.advanceTimersByTime(WELL_AFTER_RELEASE);
    });

    expect(listTransform()).toBe('translateY(0px)');
  });

  it('没有会话时完全不介入', () => {
    mount(0);
    setMetrics(nav(), { scrollTop: 0, scrollHeight: 500, clientHeight: 300 });

    const event = dispatchWheel(nav(), 100);

    expect(event.defaultPrevented).toBe(false);
  });
});
