// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEffect } from 'react';
import { OPENING_MS, useAssistantOpening } from './useAssistantOpening';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

/** 把 hook 的返回值捞出来（跟着每次渲染更新） */
let opening = false;
function Probe({ enabled }: { enabled: boolean }) {
  const value = useAssistantOpening(enabled);
  useEffect(() => {
    opening = value;
  });
  return null;
}

const setEnabled = (enabled: boolean) => {
  act(() => {
    root.render(<Probe enabled={enabled} />);
  });
};

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  opening = false;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('助手模式的「刚打开」窗口', () => {
  it('从关到开：立刻为真，过了窗口自己落回去', () => {
    setEnabled(false);
    expect(opening).toBe(false);

    setEnabled(true);
    expect(opening).toBe(true);

    // 窗口里一直是真（分栏线 460ms、光带 700ms 都要演完）
    act(() => vi.advanceTimersByTime(OPENING_MS - 50));
    expect(opening).toBe(true);

    act(() => vi.advanceTimersByTime(60));
    expect(opening).toBe(false);
  });

  it('页面加载时就开着：不演（界面本来就在那儿）', () => {
    setEnabled(true);

    expect(opening).toBe(false);
  });

  it('一直开着不会被反复触发', () => {
    setEnabled(true);
    setEnabled(true);
    setEnabled(true);

    expect(opening).toBe(false);
  });

  it('中途关掉：立刻收回，不留半截的动画窗口', () => {
    setEnabled(false);
    setEnabled(true);
    expect(opening).toBe(true);

    setEnabled(false);
    expect(opening).toBe(false);

    // 原来那个定时器不该把状态又翻回来
    act(() => vi.advanceTimersByTime(OPENING_MS * 2));
    expect(opening).toBe(false);
  });

  it('关掉再打开：重新演一遍', () => {
    setEnabled(false);
    setEnabled(true);
    act(() => vi.advanceTimersByTime(OPENING_MS + 10));
    expect(opening).toBe(false);

    setEnabled(false);
    setEnabled(true);
    expect(opening).toBe(true);
  });

  it('卸载时把定时器清掉（别在卸载后改状态）', () => {
    setEnabled(false);
    setEnabled(true);

    act(() => root.unmount());
    // 没清干净的话这里会报 "state update on unmounted component"
    expect(() => act(() => vi.advanceTimersByTime(OPENING_MS * 2))).not.toThrow();

    root = createRoot(host); // 让 afterEach 的 unmount 有东西可卸
  });
});
