import { describe, expect, it } from 'vitest';
import { overscrollDirection, rubberBandOffset } from './useRubberBandScroll';

const metrics = (over: Partial<{ scrollTop: number; scrollHeight: number; clientHeight: number }> = {}) => ({
  scrollTop: 0,
  scrollHeight: 1000,
  clientHeight: 400,
  ...over,
});

describe('rubberBandOffset', () => {
  it('0 拉动量对应 0 位移', () => {
    expect(rubberBandOffset(0, 120)).toBe(0);
  });

  it('保留方向', () => {
    expect(rubberBandOffset(50, 120)).toBeGreaterThan(0);
    expect(rubberBandOffset(-50, 120)).toBeLessThan(0);
  });

  it('拉动量越大位移越大，但恒不超过上限', () => {
    const max = 120;
    let previous = 0;
    for (const raw of [10, 40, 120, 480, 100000]) {
      const offset = rubberBandOffset(raw, max);
      expect(offset).toBeGreaterThan(previous);
      expect(offset).toBeLessThan(max);
      previous = offset;
    }
  });

  it('小拉动量接近 1:1，不会一上手就发飘', () => {
    const max = 120;
    const offset = rubberBandOffset(10, max);
    expect(offset).toBeGreaterThan(9);
    expect(offset).toBeLessThanOrEqual(10);
  });

  it('大拉动量明显衰减', () => {
    const max = 120;
    // 拉到 4 倍上限时位移应落到上限的 80% 左右，而不是跟着线性涨
    expect(rubberBandOffset(4 * max, max)).toBeCloseTo(0.8 * max, 5);
  });
});

describe('overscrollDirection', () => {
  it('到底后继续往下滚 → 回弹（+1）', () => {
    expect(overscrollDirection(metrics({ scrollTop: 600 }), 100)).toBe(1);
  });

  it('到底后往上滚 → 正常滚动（0）', () => {
    expect(overscrollDirection(metrics({ scrollTop: 600 }), -100)).toBe(0);
  });

  it('到顶后继续往上滚 → 回弹（-1）', () => {
    expect(overscrollDirection(metrics({ scrollTop: 0 }), -100)).toBe(-1);
  });

  it('到顶后往下滚 → 正常滚动（0）', () => {
    expect(overscrollDirection(metrics({ scrollTop: 0 }), 100)).toBe(0);
  });

  it('中间位置两个方向都正常滚动', () => {
    expect(overscrollDirection(metrics({ scrollTop: 300 }), 100)).toBe(0);
    expect(overscrollDirection(metrics({ scrollTop: 300 }), -100)).toBe(0);
  });

  it('内容不足以滚动时两端都能拉', () => {
    const short = { scrollTop: 0, scrollHeight: 300, clientHeight: 400 };
    expect(overscrollDirection(short, 100)).toBe(1);
    expect(overscrollDirection(short, -100)).toBe(-1);
  });

  it('亚像素误差不会让底部误判为未到底', () => {
    expect(overscrollDirection({ scrollTop: 599.5, scrollHeight: 1000, clientHeight: 400 }, 100)).toBe(1);
  });

  it('delta 为 0 时不触发', () => {
    expect(overscrollDirection(metrics({ scrollTop: 0 }), 0)).toBe(0);
    expect(overscrollDirection(metrics({ scrollTop: 600 }), 0)).toBe(0);
  });
});
