// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConversationScrollRail, type RailItem } from './ConversationScrollRail';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLIENT_HEIGHT = 500;
const SCROLL_HEIGHT = 2000;
const MESSAGE_STEP = 100;
const RAIL_PADDING = 16;
const MESSAGE_COUNT = 20;

// 5 次用户输入散落在 20 条消息里，下标 0 / 4 / 8 / 12 / 16
const USER_MESSAGE_INDICES = [0, 4, 8, 12, 16];
const items: RailItem[] = USER_MESSAGE_INDICES.map((index, i) => ({
  index,
  text: `提问 ${i}`,
}));

function Harness({ railItems = items }: { railItems?: RailItem[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const childCount = Math.max(MESSAGE_COUNT, ...railItems.map(item => item.index + 1));
  return (
    <>
      <div ref={containerRef} data-testid="container">
        <div ref={contentRef} data-testid="content">
          {Array.from({ length: childCount }, (_, i) => (
            <div key={i}>消息 {i}</div>
          ))}
        </div>
      </div>
      <ConversationScrollRail
        containerRef={containerRef}
        contentRef={contentRef}
        items={railItems}
      />
    </>
  );
}

const stubRect = (el: Element, top: number, height: number) => {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      left: 0,
      right: 0,
      width: 0,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
};

const stubScroll = (el: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: 0 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
};

const pointer = (type: string, clientY: number) => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientY: number;
    pointerId: number;
  };
  event.clientY = clientY;
  event.pointerId = 1;
  return event;
};

const pressKey = (target: Element, key: string) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

let root: Root;
let host: HTMLElement;
let container: HTMLElement;
let content: HTMLElement;

const rail = () => host.querySelector('[role="scrollbar"]') as HTMLElement | null;
const dashes = () => Array.from(host.querySelectorAll('[role="scrollbar"] [data-part="dash"]'));
const thumb = () => host.querySelector('[data-part="thumb"]') as HTMLElement | null;
const track = () => host.querySelector('[data-part="track"]') as HTMLElement | null;
const previewText = () =>
  host.querySelector('[role="scrollbar"]')?.parentElement?.querySelector('.line-clamp-3')
    ?.textContent ?? null;

/** 第 index 条横线的中心 y */
const dashY = (index: number, total = items.length) =>
  RAIL_PADDING + ((CLIENT_HEIGHT - RAIL_PADDING * 2) * index) / (total - 1);

/** 轨道上某个比例对应的 y */
const fractionY = (fraction: number) =>
  RAIL_PADDING + (CLIENT_HEIGHT - RAIL_PADDING * 2) * fraction;

/** n 次提问，消息下标即 0..n-1 */
const manyItems = (n: number): RailItem[] =>
  Array.from({ length: n }, (_, i) => ({ index: i, text: `提问 ${i}` }));

const mount = (railItems: RailItem[] = items) => {
  act(() => {
    root.render(<Harness railItems={railItems} />);
  });

  container = host.querySelector('[data-testid="container"]') as HTMLElement;
  content = host.querySelector('[data-testid="content"]') as HTMLElement;

  stubRect(container, 0, CLIENT_HEIGHT);
  Array.from(content.children).forEach((child, i) => stubRect(child, i * MESSAGE_STEP, MESSAGE_STEP));
  stubScroll(container, SCROLL_HEIGHT, CLIENT_HEIGHT);

  // 触发一次重新测量，让轨道拿到真实几何
  act(() => {
    container.dispatchEvent(new Event('scroll'));
  });

  const railEl = rail();
  if (railEl) stubRect(railEl, 0, CLIENT_HEIGHT);
};

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  mount();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('横线数量', () => {
  it('每条提问一条横线，数量与提问数一致', () => {
    expect(dashes()).toHaveLength(items.length);
  });

  it('提问条数变化时横线跟着变', () => {
    mount(items.slice(0, 3));
    expect(dashes()).toHaveLength(3);
  });

  it('没有提问时不渲染轨道', () => {
    mount([]);
    expect(rail()).toBeNull();
  });

  it('内容不足以滚动时不渲染轨道', () => {
    act(() => {
      Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 400 });
      container.dispatchEvent(new Event('scroll'));
    });
    expect(rail()).toBeNull();
  });
});

describe('预览用户输入', () => {
  it('悬停第一条预览第一次提问', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', dashY(0)));
    });
    expect(previewText()).toBe('提问 0');
  });

  it('悬停最后一条预览最后一次提问', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', dashY(items.length - 1)));
    });
    expect(previewText()).toBe('提问 4');
  });

  it('悬停中间某条预览对应的那一次提问', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', dashY(2)));
    });
    expect(previewText()).toBe('提问 2');
  });

  it('落在两条之间时吸附到较近的一条', () => {
    const between = (dashY(1) + dashY(2)) / 2 + 5;
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', between));
    });
    expect(previewText()).toBe('提问 2');
  });

  it('离开轨道后预览消失', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', dashY(0)));
    });
    expect(previewText()).toBe('提问 0');

    // React 的 onPointerLeave 由原生 pointerout 合成
    act(() => {
      rail()!.dispatchEvent(pointer('pointerout', dashY(0)));
    });
    expect(previewText()).toBeNull();
  });
});

describe('跳转', () => {
  it('点击某条横线滚到那次提问的位置', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', dashY(2)));
    });
    // 提问 2 是第 8 条消息，每条 100px
    expect(container.scrollTop).toBe(800);
  });

  it('点击第一条回到起点', () => {
    container.scrollTop = 900;
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', dashY(0)));
    });
    expect(container.scrollTop).toBe(0);
  });

  it('点击最后一条滚到该提问处', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', dashY(items.length - 1)));
    });
    expect(container.scrollTop).toBe(1600);
  });

  it('拖动过程中持续跟随', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', dashY(4)));
    });
    expect(container.scrollTop).toBe(1600);

    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', dashY(1)));
    });
    expect(container.scrollTop).toBe(400);
  });

  it('未按下时移动不会改变滚动位置', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', dashY(3)));
    });
    expect(container.scrollTop).toBe(0);
  });
});

describe('密度自适应', () => {
  it('提问少时散开', () => {
    expect(rail()!.style.gap).toBe('16px');
  });

  it('提问变多时间距收紧', () => {
    mount(manyItems(60));
    const gap = Number.parseFloat(rail()!.style.gap);
    expect(gap).toBeGreaterThan(0);
    expect(gap).toBeLessThan(16);
  });

  it('再多一些会继续变密', () => {
    mount(manyItems(60));
    const at60 = Number.parseFloat(rail()!.style.gap);
    mount(manyItems(110));
    const at110 = Number.parseFloat(rail()!.style.gap);

    expect(at110).toBeLessThan(at60);
    expect(at110).toBeGreaterThan(0);
  });

  it('密到画不下时变成滑动条', () => {
    mount(manyItems(140));

    expect(dashes()).toHaveLength(0);
    expect(thumb()).not.toBeNull();
    expect(track()).not.toBeNull();
  });

  it('滑动条形态仍可悬停预览对应的提问', () => {
    mount(manyItems(140));

    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', fractionY(0.5)));
    });

    expect(previewText()).toBe('提问 70');
  });
});

describe('滑动条形态', () => {
  it('滑块高度反映可见比例', () => {
    mount(manyItems(140));

    // 可见 500 / 总高 2000，可用高度 468
    const expected = (CLIENT_HEIGHT - RAIL_PADDING * 2) * (CLIENT_HEIGHT / SCROLL_HEIGHT);
    expect(Number.parseFloat(thumb()!.style.height)).toBeCloseTo(expected, 1);
  });

  it('点击按比例滚动，而不是跳到某一次提问', () => {
    mount(manyItems(140));

    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', fractionY(0.5)));
    });

    expect(container.scrollTop).toBeCloseTo((SCROLL_HEIGHT - CLIENT_HEIGHT) * 0.5, 1);
  });

  it('点击两端分别到顶和到底', () => {
    mount(manyItems(140));

    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', fractionY(1)));
    });
    expect(container.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);

    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', fractionY(0)));
    });
    expect(container.scrollTop).toBe(0);
  });
});

describe('键盘与语义', () => {
  it('方向键小步滚动', () => {
    const event = pressKey(rail()!, 'ArrowDown');
    expect(event.defaultPrevented).toBe(true);
    expect(container.scrollTop).toBe(48);
  });

  it('PageDown 按视口高度滚动', () => {
    pressKey(rail()!, 'PageDown');
    expect(container.scrollTop).toBe(CLIENT_HEIGHT * 0.9);
  });

  it('Home / End 直达两端', () => {
    pressKey(rail()!, 'End');
    expect(container.scrollTop).toBe(SCROLL_HEIGHT);
    pressKey(rail()!, 'Home');
    expect(container.scrollTop).toBe(0);
  });

  it('未处理的按键不拦截', () => {
    expect(pressKey(rail()!, 'a').defaultPrevented).toBe(false);
  });

  it('暴露滚动条语义', () => {
    const el = rail();
    expect(el?.getAttribute('aria-orientation')).toBe('vertical');
    expect(el?.getAttribute('aria-controls')).toBe('conversation-scroll');
    expect(el?.getAttribute('tabindex')).toBe('0');
  });
});
