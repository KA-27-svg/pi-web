// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AssistantLayout } from './AssistantLayout';
import { DEFAULT_RATIO } from '../utils/paneRatio';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

/** jsdom 没有 matchMedia。默认当作宽屏；要测窄屏就传 true */
function stubMatchMedia(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query.includes('900px'),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

const render = (props: Partial<React.ComponentProps<typeof AssistantLayout>> = {}) => {
  act(() => {
    root.render(
      <AssistantLayout
        enabled
        ratio={0.5}
        onRatioChange={() => undefined}
        main={<p>执行窗口</p>}
        advisor={<p>顾问窗口</p>}
        {...props}
      />
    );
  });
};

const separator = () => host.querySelector('[role="separator"]') as HTMLElement | null;
const text = () => host.textContent ?? '';

beforeEach(() => {
  stubMatchMedia(false);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('分栏', () => {
  it('关着的时候只有一个 pane，也不渲染分隔条', () => {
    render({ enabled: false, advisor: undefined });

    expect(text()).toContain('执行窗口');
    expect(text()).not.toContain('顾问窗口');
    expect(separator()).toBeNull();
  });

  it('开着的时候两个 pane 并排，中间有分隔条', () => {
    render();

    expect(text()).toContain('执行窗口');
    expect(text()).toContain('顾问窗口');
    expect(separator()).not.toBeNull();
    expect(separator()?.getAttribute('aria-orientation')).toBe('vertical');
  });

  it('两栏的宽度按比例分（顾问在右）', () => {
    render({ ratio: 0.3 });

    const columns = [...host.querySelectorAll('div[style]')] as HTMLElement[];
    const grow = columns.map(column => column.style.flexGrow);
    expect(grow).toEqual(['0.7', '0.3']);
  });
});

describe('拖动分隔条', () => {
  it('按指针位置改比例（顾问在右，从容器右边量）', () => {
    const onRatioChange = vi.fn();
    render({ onRatioChange });

    // jsdom 量出来的尺寸全是 0，手动给一个
    const container = host.firstElementChild as HTMLElement;
    container.getBoundingClientRect = () =>
      ({ right: 800, width: 800, left: 0, top: 0, bottom: 600, height: 600, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const bar = separator() as HTMLElement;
    act(() => {
      bar.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 400 }));
    });
    act(() => {
      bar.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 600 }));
    });

    expect(onRatioChange).toHaveBeenLastCalledWith(0.25);
  });

  it('没按下时移动不产生任何变化', () => {
    const onRatioChange = vi.fn();
    render({ onRatioChange });

    act(() => {
      (separator() as HTMLElement).dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX: 600 })
      );
    });

    expect(onRatioChange).not.toHaveBeenCalled();
  });

  it('双击复位到默认比例', () => {
    const onRatioChange = vi.fn();
    render({ onRatioChange });

    act(() => {
      (separator() as HTMLElement).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });

    expect(onRatioChange).toHaveBeenCalledWith(DEFAULT_RATIO);
  });
});

describe('窄屏', () => {
  it('不并排，改成 tab 切换', () => {
    stubMatchMedia(true);
    render();

    expect(separator()).toBeNull();
    expect(text()).toContain('执行');
    expect(text()).toContain('顾问');
    // 默认停在执行窗口
    expect(text()).toContain('执行窗口');
    expect(text()).not.toContain('顾问窗口');
  });

  it('点 tab 换到顾问窗口', () => {
    stubMatchMedia(true);
    render();

    const advisorTab = [...host.querySelectorAll('button')].find(button =>
      (button.textContent ?? '').includes('顾问')
    ) as HTMLButtonElement;

    act(() => {
      advisorTab.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(text()).toContain('顾问窗口');
    expect(text()).not.toContain('执行窗口');
  });
});

describe('打开那一刻的动画', () => {
  /** 顾问栏是分隔条后面那个 pane */
  const advisorPane = () => separator()?.nextElementSibling as HTMLElement | null;

  it('opening 为真：分栏线与顾问栏都挂上动画类', () => {
    render({ opening: true });

    expect(separator()?.className).toContain('assistant-seam-open');
    expect(advisorPane()?.className).toContain('assistant-pane-open');
  });

  it('opening 落回去后类就摘掉（残留的 transform 会把 fixed 元素带偏）', () => {
    render({ opening: true });
    render({ opening: false });

    expect(separator()?.className).not.toContain('assistant-seam-open');
    expect(advisorPane()?.className).not.toContain('assistant-pane-open');
  });

  it('不传 opening（默认）就是安静的，没有任何动画类', () => {
    render();

    expect(separator()?.className).not.toContain('assistant-seam-open');
    expect(advisorPane()?.className).not.toContain('assistant-pane-open');
  });

  it('关着时不演（没有顾问栏可铺）', () => {
    render({ enabled: false, opening: true, advisor: undefined });

    expect(host.querySelector('.assistant-pane-open')).toBeNull();
    expect(host.querySelector('.assistant-seam-open')).toBeNull();
  });

  it('窄屏没有分栏线，改成 tab 条淡进来', () => {
    stubMatchMedia(true);
    render({ opening: true });

    expect(separator()).toBeNull();
    expect(host.querySelector('.assistant-fade-open')).not.toBeNull();
    expect(host.querySelector('.assistant-pane-open')).toBeNull();
  });
});
