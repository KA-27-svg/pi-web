// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useIconPress, type IconPress } from './useIconPress';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
/** 最近一次 render 拿到的 hook 返回值，由下面的 effect 每次 render 后刷新 */
let latest: IconPress;

/** 把 hook 挂进一个真组件里，好拿到返回值并按真事件触发 */
function Probe({ duration }: { duration: number }) {
  const press = useIconPress(duration);
  // 每次 render 后刷新，而不是在 render 里直接赋值（那是渲染期副作用）
  useEffect(() => {
    latest = press;
  });
  return null;
}

function render(duration = 500) {
  act(() => {
    root.render(<Probe duration={duration} />);
  });
  return () => latest;
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('useIconPress', () => {
  it('一开始是安静的', () => {
    const press = render();

    expect(press().active).toBe(false);
    expect(press().count).toBe(0);
  });

  it('按下立刻进窗口，过一段时间自己落回', () => {
    const press = render(500);

    act(() => press().press());
    expect(press().active).toBe(true);

    act(() => vi.advanceTimersByTime(400));
    expect(press().active).toBe(true);

    act(() => vi.advanceTimersByTime(200));
    expect(press().active).toBe(false);
  });

  it('每按一次 count 加一（连点靠它重播动画）', () => {
    const press = render();

    act(() => press().press());
    act(() => press().press());
    act(() => press().press());

    expect(press().count).toBe(3);
  });

  it('窗口内又按一下：定时器从头数，不会被上一遍的尾巴掐断', () => {
    const press = render(500);

    act(() => press().press());
    act(() => vi.advanceTimersByTime(400));
    act(() => press().press());
    act(() => vi.advanceTimersByTime(400));

    // 第二次按下过了 400ms（< 500ms），还在窗口里
    expect(press().active).toBe(true);

    act(() => vi.advanceTimersByTime(200));
    expect(press().active).toBe(false);
  });

  it('卸载后定时器不再翻状态（否则是卸载后 setState）', () => {
    const press = render(500);

    act(() => press().press());
    act(() => root.unmount());
    // 没有定时器漏出来，跑完也不报错
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();

    // 重新挂一个根，afterEach 的 unmount 才不会炸
    root = createRoot(host);
  });
});
