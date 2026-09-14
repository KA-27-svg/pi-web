// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { ChatInput } from './ChatInput';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

let root: Root;
let host: HTMLElement;

const textarea = () => host.querySelector('textarea') as HTMLTextAreaElement;
const stage = () => host.querySelector('.pi-stage') as HTMLElement;
const composerHeight = () => stage().style.getPropertyValue('--composer-height');
const morphing = () => stage().hasAttribute('data-morphing');

const mount = (props: Partial<React.ComponentProps<typeof ChatInput>> = {}) => {
  act(() => {
    root.render(
      <ChatInput onSend={noop} onStop={noop} isLoading={false} {...props} />
    );
  });
};

/** jsdom 没有布局，textarea 的内容高度需要手动钉住 */
const setScrollHeight = (value: number) => {
  Object.defineProperty(textarea(), 'scrollHeight', { configurable: true, value });
};

/** 走 React 受控组件的正常路径改值 */
const type = (value: string) => {
  const el = textarea();
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('输入框高度自适应', () => {
  it('单行时外壳取最小高度', () => {
    mount();
    expect(composerHeight()).toBe('53px');
  });

  it('换行后外壳跟着长高（之前会溢出到背景外）', () => {
    mount();
    setScrollHeight(120);
    type('第一行\n第二行');

    expect(composerHeight()).toBe('120px');
    expect(textarea().style.height).toBe('120px');
  });

  it('内容比最小高度还矮时不会塌陷', () => {
    mount();
    setScrollHeight(10);
    type('字');

    expect(composerHeight()).toBe('53px');
  });

  it('超过上限时封顶，与 textarea 的 max-h-48 一致', () => {
    mount();
    setScrollHeight(500);
    type('很多很多行');

    expect(composerHeight()).toBe('192px');
  });

  it('清空后收回最小高度', () => {
    mount();
    setScrollHeight(120);
    type('第一行\n第二行');
    expect(composerHeight()).toBe('120px');

    setScrollHeight(53);
    type('');
    expect(composerHeight()).toBe('53px');
  });

  it('高度没变化时不写外壳、也不通知父级', () => {
    // 开场形变期间宽度每帧都在变，measure 会被高频调用；
    // 只要高度没变就必须什么都不做，否则动画会被反复打断
    const onResize = vi.fn();
    mount({ onResize });
    onResize.mockClear();

    type('一');

    expect(onResize).not.toHaveBeenCalled();
  });

  it('高度变化时通知父级，便于贴底时重新对齐', () => {
    const onResize = vi.fn();
    mount({ onResize });
    expect(onResize).toHaveBeenCalled();

    onResize.mockClear();
    setScrollHeight(120);
    type('第一行\n第二行');

    expect(onResize).toHaveBeenCalled();
  });
});

describe('外壳高度确实由 JS 与 CSS 共同约定', () => {
  // jsdom 不加载外部 CSS、也不支持 var() 求值，所以只能直接校验这条约定的两端：
  // 上面几条只证明了 JS 写入了变量，这里证明 CSS 真的用了它。
  // 用 cwd 相对路径读源文件：vitest 默认会桩掉 CSS 导入，拿不到原始文本
  const css = readFileSync('src/components/ChatInput.css', 'utf8');

  it('舞台与外壳都拿 --composer-height 决定高度', () => {
    const uses = css.match(/height:\s*var\(--composer-height[^;]*;/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
  });

  it('外壳不再写死的 53px', () => {
    expect(css).not.toMatch(/\.pi-composer\s*\{[^}]*height:\s*53px/);
    expect(css).not.toMatch(/\.pi-stage\s*\{[^}]*height:\s*53px/);
  });

  it('形变窗口由 data-morphing 控制，而不是把变量写进 transition', () => {
    const composerRule = (css.match(/\.pi-composer\s*\{[^}]*\}/) ?? [''])[0];
    const transition = (composerRule.match(/transition:[^;]*;/) ?? [''])[0];

    // transition 里一旦出现 var()，动画期间任何自定义属性变动都会让它重新求值
    expect(transition).not.toContain('var(');
    // 平时高度不参与过渡，打字时外壳才能立刻跟上文字
    expect(transition).not.toContain('height');
  });

  it('形变窗口内高度确实参与过渡', () => {
    const morphRule = (css.match(/\.pi-stage\[data-morphing\][^{]*\{[^}]*\}/) ?? [''])[0];
    expect(morphRule).toMatch(/height\s+620ms/);
  });
});

describe('高度过渡只在开场形变期间生效', () => {
  it('图标态处于形变窗口', () => {
    mount({ showIcon: true });
    expect(morphing()).toBe(true);
  });

  it('不是图标态时不处于形变窗口，打字不会有高度过渡', () => {
    mount({ showIcon: false });
    expect(morphing()).toBe(false);
  });

  it('从图标态展开时，形变窗口内仍保留高度过渡', () => {
    vi.useFakeTimers();
    mount({ showIcon: true });
    expect(morphing()).toBe(true);

    // 用户点击展开
    act(() => {
      root.render(
        <ChatInput onSend={noop} onStop={noop} isLoading={false} showIcon={false} />
      );
    });
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(morphing()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(morphing()).toBe(false);
  });
});
