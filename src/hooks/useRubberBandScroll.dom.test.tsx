// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useRubberBandScroll } from './useRubberBandScroll';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RELEASE_DELAY = 40;

function Harness({ enabled }: { enabled: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useRubberBandScroll(containerRef, contentRef, {
    enabled,
    releaseDelay: RELEASE_DELAY,
    releaseDuration: 1,
  });
  return (
    <div ref={containerRef} data-testid="container">
      <div ref={contentRef} data-testid="content">
        消息
      </div>
    </div>
  );
}

/** jsdom 没有布局，scroll 指标需要手动钉住 */
const setMetrics = (
  el: HTMLElement,
  metrics: { scrollTop?: number; scrollHeight?: number; clientHeight?: number }
) => {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(el, key, { configurable: true, writable: true, value });
  }
};

/** 用普通 Event 并挂上字段，避免依赖 jsdom 的 WheelEvent 支持 */
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

let root: Root;
let host: HTMLElement;
let container: HTMLElement;
let content: HTMLElement;

beforeEach(() => {
  // jsdom 未实现 matchMedia，同时保证不落入 prefers-reduced-motion 分支
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
  act(() => {
    root.render(<Harness enabled />);
  });
  container = host.querySelector('[data-testid="container"]') as HTMLElement;
  content = host.querySelector('[data-testid="content"]') as HTMLElement;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const transform = () => content.style.transform;

describe('边界回弹', () => {
  it('已在底部继续下滚时接管事件并拉出位移', () => {
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    const event = dispatchWheel(container, 100);

    expect(event.defaultPrevented).toBe(true);
    // 内容向上让出空间，位移为负
    expect(transform()).toMatch(/translateY\(-\d/);
  });

  it('已在顶部继续上滚时也能拉出位移', () => {
    setMetrics(container, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });

    const event = dispatchWheel(container, -100);

    expect(event.defaultPrevented).toBe(true);
    // 内容向下让出空间，位移为正
    expect(transform()).toMatch(/translateY\(\d/);
  });

  it('未到边界时不接管，交还原生滚动', () => {
    setMetrics(container, { scrollTop: 300, scrollHeight: 1000, clientHeight: 400 });

    const event = dispatchWheel(container, 100);

    expect(event.defaultPrevented).toBe(false);
    expect(transform()).toBe('');
  });

  it('松手后回弹到原位', () => {
    vi.useFakeTimers();
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    dispatchWheel(container, 100);
    expect(transform()).toMatch(/translateY\(-\d/);

    act(() => {
      vi.advanceTimersByTime(RELEASE_DELAY + 1);
    });

    expect(transform()).toBe('translateY(0px)');
  });

  it('未松手时连续滚动会持续累积位移', () => {
    vi.useFakeTimers();
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    dispatchWheel(container, 100);
    const afterFirst = parseFloat(transform().replace(/[^-\d.]/g, ''));
    act(() => {
      vi.advanceTimersByTime(RELEASE_DELAY - 10);
    });
    dispatchWheel(container, 100);
    const afterSecond = parseFloat(transform().replace(/[^-\d.]/g, ''));

    expect(Math.abs(afterSecond)).toBeGreaterThan(Math.abs(afterFirst));
  });

  it('反向滚动立即释放并把控制权交还原生滚动', () => {
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    dispatchWheel(container, 100);
    expect(transform()).toMatch(/translateY\(-\d/);

    // 在底部往上滚 = 回到内容里，应该立刻回弹且不再接管事件
    const back = dispatchWheel(container, -100);

    expect(back.defaultPrevented).toBe(false);
    expect(transform()).toBe('translateY(0px)');
  });
});

describe('不该触发的情况', () => {
  it('不产生 wheel 事件（拖动滚动条）不会有任何位移', () => {
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    // 拖动滚动条只会改 scrollTop，不会有 wheel 事件
    container.scrollTop = 300;

    expect(transform()).toBe('');
  });

  it('内部可滚动区域还有余量时让给它', () => {
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    content.appendChild(inner);
    setMetrics(inner, { scrollTop: 0, scrollHeight: 500, clientHeight: 200 });
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    const event = dispatchWheel(inner, 100);

    expect(event.defaultPrevented).toBe(false);
    expect(transform()).toBe('');
  });

  it('内部可滚动区域到底后仍可拉动外层', () => {
    const inner = document.createElement('div');
    inner.style.overflowY = 'auto';
    content.appendChild(inner);
    setMetrics(inner, { scrollTop: 300, scrollHeight: 500, clientHeight: 200 });
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    const event = dispatchWheel(inner, 100);

    expect(event.defaultPrevented).toBe(true);
    expect(transform()).toMatch(/translateY\(-\d/);
  });

  it('ctrl+滚轮（缩放）不接管', () => {
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    const event = new Event('wheel', { bubbles: true, cancelable: true }) as Event & {
      deltaY: number;
      deltaMode: number;
      ctrlKey: boolean;
    };
    event.deltaY = 100;
    event.deltaMode = 0;
    event.ctrlKey = true;
    container.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(transform()).toBe('');
  });

  it('enabled 为 false 时完全不介入', () => {
    act(() => {
      root.render(<Harness enabled={false} />);
    });
    setMetrics(container, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });

    const event = dispatchWheel(container, 100);

    expect(event.defaultPrevented).toBe(false);
    expect(transform()).toBe('');
  });
});
