import { describe, expect, it } from 'vitest';
import {
  THREAD_PAGE,
  growWindow,
  initialWindow,
  visibleSlice,
  windowSizeFor,
} from './threadWindow';

describe('对话区渲染窗口', () => {
  it('初始只渲染一页', () => {
    expect(windowSizeFor(initialWindow(), 'h1')).toBe(THREAD_PAGE);
  });

  it('同一段历史里沿用已展开的量', () => {
    const grown = growWindow(initialWindow(), 'h1', 500);
    expect(windowSizeFor(grown, 'h1')).toBe(THREAD_PAGE * 2);
  });

  it('换了会话就回到一页，避免把上个会话展开的量带过去', () => {
    let w = initialWindow();
    w = growWindow(w, 'h1', 500);
    w = growWindow(w, 'h1', 500);
    expect(windowSizeFor(w, 'h1')).toBe(THREAD_PAGE * 3);

    // 新的历史（key 变了）
    expect(windowSizeFor(w, 'h2')).toBe(THREAD_PAGE);
  });

  it('补页不会超过实际条数', () => {
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
    const { visible, startIndex, hasEarlier } = visibleSlice(history, initialWindow(), 'h1');

    expect(visible).toHaveLength(THREAD_PAGE);
    expect(visible[0]).toBe('m70');
    expect(visible[visible.length - 1]).toBe('m119');
    expect(startIndex).toBe(70);
    expect(hasEarlier).toBe(true);
  });

  it('短会话全都渲染，且不给「更早」提示', () => {
    const { visible, hasEarlier } = visibleSlice(history.slice(0, 10), initialWindow(), 'h1');

    expect(visible).toHaveLength(10);
    expect(hasEarlier).toBe(false);
  });

  it('补了一页后渲染的片段往前扩一段', () => {
    const grown = growWindow(initialWindow(), 'h1', history.length);
    const { visible, hasEarlier } = visibleSlice(history, grown, 'h1');

    expect(visible).toHaveLength(THREAD_PAGE * 2);
    expect(visible[0]).toBe('m20');
    expect(hasEarlier).toBe(true);
  });

  it('换会话后回到只渲染末尾一页', () => {
    const grown = growWindow(initialWindow(), 'h1', history.length);
    const { visible, hasEarlier } = visibleSlice(history, grown, 'h2');

    expect(visible).toHaveLength(THREAD_PAGE);
    expect(hasEarlier).toBe(true);
  });
});
