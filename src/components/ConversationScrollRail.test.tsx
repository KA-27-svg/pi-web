// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

function Harness({
  railItems = items,
  sentinel = false,
  renderCount,
  onNeedRender,
}: {
  railItems?: RailItem[];
  sentinel?: boolean;
  /** 限制实际渲染多少条消息（模拟「窗口还没滑到某条」） */
  renderCount?: number;
  onNeedRender?: (absoluteIndex: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const childCount =
    renderCount ?? Math.max(MESSAGE_COUNT, ...railItems.map(item => item.index + 1));
  return (
    <>
      <div ref={containerRef} data-testid="container">
        <div ref={contentRef} data-testid="content">
          {/* 真实内容里，历史还有更早的一页时，消息前面会多一个哨兵 div */}
          {sentinel && <div>向上滚动加载更早的消息</div>}
          {Array.from({ length: childCount }, (_, i) => (
            <div key={i} data-message-index={i}>
              消息 {i}
            </div>
          ))}
        </div>
      </div>
      <ConversationScrollRail
        containerRef={containerRef}
        contentRef={contentRef}
        items={railItems}
        onNeedRender={onNeedRender}
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
/** 组件注册的 ResizeObserver 回调，用来在测试里模拟内容尺寸变化 */
const resizeCallbacks: Array<() => void> = [];

const setScrollHeight = (value: number) => {
  Object.defineProperty(container, 'scrollHeight', { configurable: true, value });
};

/** 模拟内容高度变化触发 ResizeObserver */
const resize = () =>
  act(() => {
    for (const callback of resizeCallbacks) callback();
  });

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

const mount = (railItems: RailItem[] = items, sentinel = false) => {
  act(() => {
    root.render(<Harness railItems={railItems} sentinel={sentinel} />);
  });

  container = host.querySelector('[data-testid="container"]') as HTMLElement;
  content = host.querySelector('[data-testid="content"]') as HTMLElement;

  stubRect(container, 0, CLIENT_HEIGHT);
  Array.from(content.children).forEach((child, i) => stubRect(child, i * MESSAGE_STEP, MESSAGE_STEP));
  stubScroll(container, SCROLL_HEIGHT, CLIENT_HEIGHT);

  // 触发重新测量，让轨道在 stub 之后重算锚点。
  // 先把 scrollHeight 变一下再变回来：否则第二次 mount 时 metrics 与上一次相同，
  // setMetrics 会被相等性短路掉，锚点就不会在新节点上重算。
  setScrollHeight(SCROLL_HEIGHT + 1);
  act(() => {
    container.dispatchEvent(new Event('scroll'));
  });
  setScrollHeight(SCROLL_HEIGHT);
  act(() => {
    container.dispatchEvent(new Event('scroll'));
  });

  const railEl = rail();
  if (railEl) stubRect(railEl, 0, CLIENT_HEIGHT);
};

beforeEach(() => {
  resizeCallbacks.length = 0;
  class ResizeObserverStub {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  // 同步执行 rAF，让「每帧测量」在测试里可预测；
  // 若 setMetrics 缺了相等性短路，这里会直接爆栈
  (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = (
    callback: FrameRequestCallback
  ) => {
    callback(0);
    return 1;
  };
  (globalThis as unknown as { cancelAnimationFrame: unknown }).cancelAnimationFrame = () => {};
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

  it('内容长到超过一屏后轨道自动出现（观察尺寸变化）', () => {
    setScrollHeight(400);
    resize();
    expect(rail()).toBeNull();

    // 流式输出把内容撑高，即使没有触发 scroll 事件也要能发现
    setScrollHeight(2000);
    resize();
    expect(rail()).not.toBeNull();
  });

  it('内容缩回一屏以内后轨道又隐藏', () => {
    setScrollHeight(2000);
    resize();
    expect(rail()).not.toBeNull();

    setScrollHeight(400);
    resize();
    expect(rail()).toBeNull();
  });

  it('助手回复长高时，不靠 ResizeObserver 也能出现轨道', () => {
    setScrollHeight(400);
    resize();
    expect(rail()).toBeNull();

    // 关键的回归场景：新对话挂载时内容很短，之后仅因为助手回复变长而超过一屏。
    // 此时没有 scroll 事件、也不触发 ResizeObserver，只能靠「重渲染后测量」发现它。
    // 助手输出时 messages 一直在变，items 会跟着换成新数组（轨道因此重渲染）。
    setScrollHeight(2000);
    act(() => {
      root.render(<Harness railItems={items.map(item => ({ ...item }))} />);
    });

    expect(rail()).not.toBeNull();
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

  it('历史还有更早一页（消息前面多了哨兵 div）时，也不会差一条跳到上一个回答', () => {
    // 重新挂载，让几何测量从头来一遍（否则第二次渲染时 metrics 没变，锚点不会重算）
    act(() => root.unmount());
    root = createRoot(host);
    mount(items, true);

    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', dashY(2)));
    });

    // 提问 2 是第 8 条消息；哨兵在它前面，所以 top 是 (8+1)*100
    expect(container.scrollTop).toBe(900);
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

  it('条数多到画成滑块时，点击也是跳到某次提问（窗口可滑动，按比例滚没意义）', () => {
    mount(manyItems(140));

    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', fractionY(0.5)));
    });

    // 中间那条 = 提问 70，每条 100px
    expect(container.scrollTop).toBe(70 * MESSAGE_STEP);
  });

  it('点击两端分别跳到第一条和最后一条提问', () => {
    mount(manyItems(140));

    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', fractionY(1)));
    });
    expect(container.scrollTop).toBe(139 * MESSAGE_STEP);

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

describe('跳到还没渲染的提问（窗口可滑动）', () => {
  it('先请上层滑窗口，渲染出来后再滚过去', () => {
    const onNeedRender = vi.fn();
    const one = [{ index: 5, text: '提问' }];

    // 只渲染了消息 0、1：要找的 5 还没出来
    act(() => {
      root.render(<Harness railItems={one} renderCount={2} onNeedRender={onNeedRender} />);
    });
    container = host.querySelector('[data-testid="container"]') as HTMLElement;
    content = host.querySelector('[data-testid="content"]') as HTMLElement;
    stubRect(container, 0, CLIENT_HEIGHT);
    Array.from(content.children).forEach((child, i) => stubRect(child, i * MESSAGE_STEP, MESSAGE_STEP));
    stubScroll(container, SCROLL_HEIGHT, CLIENT_HEIGHT);
    setScrollHeight(SCROLL_HEIGHT + 1);
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });
    setScrollHeight(SCROLL_HEIGHT);
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });
    stubRect(rail()!, 0, CLIENT_HEIGHT);

    act(() => {
      rail()!.dispatchEvent(pointer('pointerdown', fractionY(0)));
    });

    // 找不到锚点 → 请上层把窗口滑到第 5 条；此时还没滚
    expect(onNeedRender).toHaveBeenCalledWith(5);
    expect(container.scrollTop).toBe(0);

    // 上层滑过来了：第 5 条现在渲染出来了
    act(() => {
      root.render(<Harness railItems={one} renderCount={6} onNeedRender={onNeedRender} />);
    });
    content = host.querySelector('[data-testid="content"]') as HTMLElement;
    Array.from(content.children).forEach((child, i) => stubRect(child, i * MESSAGE_STEP, MESSAGE_STEP));

    // 触发一次重算（真实环境里窗口一变就会重算）
    setScrollHeight(SCROLL_HEIGHT + 1);
    act(() => {
      container.dispatchEvent(new Event('scroll'));
    });

    expect(container.scrollTop).toBe(5 * MESSAGE_STEP);
  });
});

describe('锚点不该每帧重算', () => {
  it('只改容器高度时（composer 形变 / 切会话过渡每帧都在改它）不重新量锚点', () => {
    mount();

    const content = host.querySelector('[data-testid="content"]') as HTMLElement;
    const first = content.children[0] as HTMLElement;

    let reads = 0;
    const original = first.getBoundingClientRect.bind(first);
    first.getBoundingClientRect = () => {
      reads += 1;
      return original();
    };

    // 先把基线跑出来：改 scrollHeight（内容尺寸变了）会让锚点必须重算一次
    setScrollHeight(SCROLL_HEIGHT + 50);
    resize();

    const before = reads;
    expect(before).toBeGreaterThan(0);

    // 只改高度：这正是开场形变 / 切会话过渡时每帧发生的事。
    // 锚点是相对内容的偏移，跟容器高度无关，不该因此重算。
    Object.defineProperty(container, 'clientHeight', {
      configurable: true,
      value: CLIENT_HEIGHT - 120,
    });
    resize();

    expect(reads).toBe(before);
  });
});
