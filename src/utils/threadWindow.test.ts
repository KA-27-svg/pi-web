import { describe, expect, it } from 'vitest';
import {
  THREAD_PAGE,
  growWindow,
  initialWindow,
  loadLater,
  visibleSlice,
  windowAround,
  windowFor,
} from './threadWindow';

describe('对话区渲染窗口', () => {
  it('初始只渲染一页', () => {
    expect(windowFor(initialWindow(), 'h1')).toEqual({ size: THREAD_PAGE, end: 0 });
  });

  it('同一段历史里沿用已展开的量', () => {
    const grown = growWindow(initialWindow(), 'h1', 500);
    expect(windowFor(grown, 'h1')).toEqual({ size: THREAD_PAGE * 2, end: 0 });
  });

  it('换了会话就回到一页，避免把上个会话的位置带过去', () => {
    let w = initialWindow();
    w = growWindow(w, 'h1', 500);
    w = growWindow(w, 'h1', 500);
    w = windowAround('h1', 500, 100);
    expect(windowFor(w, 'h1').end).toBeGreaterThan(0);

    // 新的历史（key 变了）
    expect(windowFor(w, 'h2')).toEqual({ size: THREAD_PAGE, end: 0 });
  });

  it('向上补页不会超过窗口上沿', () => {
    const w = growWindow(initialWindow(), 'h1', 60);
    expect(w.size).toBe(60);

    expect(growWindow(w, 'h1', 60).size).toBe(60);
  });

  it('消息很少时窗口就是全部', () => {
    expect(growWindow(initialWindow(), 'h1', 3).size).toBe(3);
  });
});

describe('实际渲染的片段', () => {
  const history = Array.from({ length: 120 }, (_, i) => `m${i}`);

  it('长会话只渲染末尾一页，其余等到往上滚才补', () => {
    const { visible, startIndex, endIndex, hasEarlier, hasLater } = visibleSlice(
      history,
      initialWindow(),
      'h1'
    );

    expect(visible).toHaveLength(THREAD_PAGE);
    expect(visible[0]).toBe('m70');
    expect(visible[visible.length - 1]).toBe('m119');
    expect(startIndex).toBe(70);
    expect(endIndex).toBe(120);
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(false);
  });

  it('短会话全都渲染，两侧都不给提示', () => {
    const { visible, hasEarlier, hasLater } = visibleSlice(history.slice(0, 10), initialWindow(), 'h1');

    expect(visible).toHaveLength(10);
    expect(hasEarlier).toBe(false);
    expect(hasLater).toBe(false);
  });

  it('向上补了一页后，片段往前扩一段', () => {
    const grown = growWindow(initialWindow(), 'h1', history.length);
    const { visible, startIndex, hasEarlier, hasLater } = visibleSlice(history, grown, 'h1');

    expect(visible).toHaveLength(THREAD_PAGE * 2);
    expect(visible[0]).toBe('m20');
    expect(startIndex).toBe(20);
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(false);
  });

  it('换会话后回到只渲染末尾一页', () => {
    const grown = growWindow(initialWindow(), 'h1', history.length);
    const { visible, hasEarlier, hasLater } = visibleSlice(history, grown, 'h2');

    expect(visible).toHaveLength(THREAD_PAGE);
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(false);
  });
});

describe('定位到某一条（右侧轨道点击还没渲染的提问）', () => {
  const history = Array.from({ length: 120 }, (_, i) => `m${i}`);

  it('把目标放到窗口开头，前后都留出未渲染的段', () => {
    const { visible, startIndex, endIndex, hasEarlier, hasLater } = visibleSlice(
      history,
      windowAround('h1', history.length, 30),
      'h1'
    );

    expect(startIndex).toBe(30);
    expect(endIndex).toBe(80);
    expect(visible[0]).toBe('m30');
    expect(visible[visible.length - 1]).toBe('m79');
    expect(hasEarlier).toBe(true);
    expect(hasLater).toBe(true);
  });

  it('目标靠近末尾时退化成末尾一页', () => {
    const { visible, hasLater } = visibleSlice(
      history,
      windowAround('h1', history.length, 110),
      'h1'
    );

    expect(visible[visible.length - 1]).toBe('m119');
    expect(hasLater).toBe(false);
  });

  it('目标越界时夹回合法范围', () => {
    const { visible } = visibleSlice(
      history,
      windowAround('h1', history.length, 9999),
      'h1'
    );

    expect(visible[visible.length - 1]).toBe('m119');
  });
});

describe('向下补页', () => {
  const history = Array.from({ length: 120 }, (_, i) => `m${i}`);

  it('上沿不动，只在下面接一段，并把尾部留白吃掉', () => {
    const jumped = windowAround('h1', history.length, 30); // 窗口 m30..m79
    const more = loadLater(jumped, 'h1'); // 再往下接一页

    const { visible, startIndex, endIndex, hasLater } = visibleSlice(history, more, 'h1');

    expect(startIndex).toBe(30);
    expect(endIndex).toBe(120);
    expect(visible[0]).toBe('m30');
    expect(visible[visible.length - 1]).toBe('m119');
    expect(hasLater).toBe(false);
  });

  it('已经贴到最新时不动', () => {
    const w = loadLater(initialWindow(), 'h1');
    expect(windowFor(w, 'h1')).toEqual({ size: THREAD_PAGE, end: 0 });
  });
});
