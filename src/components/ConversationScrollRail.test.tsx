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

const items: RailItem[] = Array.from({ length: 20 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  text: `M${i}`,
}));

function Harness() {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <>
      <div ref={containerRef} data-testid="container">
        <div ref={contentRef} data-testid="content">
          {items.map((item, i) => (
            <div key={i}>{item.text}</div>
          ))}
        </div>
      </div>
      <ConversationScrollRail
        containerRef={containerRef}
        contentRef={contentRef}
        items={items}
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
const dashes = () => Array.from(host.querySelectorAll('[role="scrollbar"] > span'));
const previewText = () =>
  host.querySelector('[role="scrollbar"]')?.parentElement?.querySelector('.line-clamp-3')
    ?.textContent ?? null;

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

  act(() => {
    root.render(<Harness />);
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
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const bottomY = () => RAIL_PADDING + (CLIENT_HEIGHT - RAIL_PADDING * 2);

describe('可滚动性', () => {
  it('内容不足以滚动时不渲染轨道', () => {
    act(() => {
      Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 400 });
      container.dispatchEvent(new Event('scroll'));
    });
    expect(rail()).toBeNull();
  });

  it('可滚动时渲染一列短横线', () => {
    expect(rail()).not.toBeNull();
    expect(dashes()).toHaveLength(26);
  });

  it('暴露滚动条语义', () => {
    const el = rail();
    expect(el?.getAttribute('aria-orientation')).toBe('vertical');
    expect(el?.getAttribute('aria-controls')).toBe('conversation-scroll');
    expect(el?.getAttribute('aria-valuenow')).toBe('0');
    expect(el?.getAttribute('tabindex')).toBe('0');
  });
});

describe('悬停预览', () => {
  it('悬停在顶部预览第一条消息', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', RAIL_PADDING));
    });
    expect(previewText()).toBe('M0');
  });

  it('悬停在底部预览该位置对应的消息（而非最后一条）', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', bottomY()));
    });
    // 比例 1 → 目标滚动 1500 → 消息 15（每条 100px），不是最后一条
    expect(previewText()).toBe('M15');
  });

  it('悬停在某条短横线上时，预览对应该横线位置的消息', () => {
    // 第 8 条横线（下标 8/25 = 32%）→ 目标滚动 480px → 消息 M4
    const y = RAIL_PADDING + (CLIENT_HEIGHT - RAIL_PADDING * 2) * (8 / 25);
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', y));
    });
    expect(previewText()).toBe('M4');
  });

  it('预览吸附到横线，但拖动跳转是连续的', () => {
    // 光标落在两条横线之间：比例 = 100/468，既不是任何一条横线的位置
    const y = RAIL_PADDING + 100;
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', y));
    });
    // 吸附后的横线是下标 5（0.2137×25≈5.34），但滚动位置必须是精确的原始比例
    const expected = ((SCROLL_HEIGHT - CLIENT_HEIGHT) * 100) / (CLIENT_HEIGHT - RAIL_PADDING * 2);
    expect(container.scrollTop).toBeCloseTo(expected, 4);
  });

  it('离开轨道后预览消失', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', RAIL_PADDING));
    });
    expect(previewText()).toBe('M0');

    // React 的 onPointerLeave 由原生 pointerout 合成
    act(() => {
      rail()!.dispatchEvent(pointer('pointerout', RAIL_PADDING));
    });
    expect(previewText()).toBeNull();
  });
});

describe('跳转', () => {
  it('按下轨道跳到对应比例的位置', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', bottomY()));
    });
    expect(container.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT);
  });

  it('按下轨道顶部回到起点', () => {
    container.scrollTop = 800;
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', RAIL_PADDING));
    });
    expect(container.scrollTop).toBe(0);
  });

  it('拖动过程中持续跟随', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', bottomY()));
    });
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', RAIL_PADDING));
    });
    expect(container.scrollTop).toBe(0);
  });

  it('未按下时移动不会改变滚动位置', () => {
    act(() => {
      rail()!.dispatchEvent(pointer('pointermove', bottomY()));
    });
    expect(container.scrollTop).toBe(0);
  });
});

describe('键盘操作', () => {
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
});
