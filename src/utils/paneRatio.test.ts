import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATIO,
  MAX_RATIO,
  MIN_RATIO,
  clampRatio,
  ratioFromPointer,
} from './paneRatio';

describe('clampRatio', () => {
  it('正常值原样通过', () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(0.3)).toBe(0.3);
  });

  it('夹在上下限之间：不能把某一栏拖到 0 宽', () => {
    expect(clampRatio(0)).toBe(MIN_RATIO);
    expect(clampRatio(-2)).toBe(MIN_RATIO);
    expect(clampRatio(1)).toBe(MAX_RATIO);
    expect(clampRatio(9)).toBe(MAX_RATIO);
  });

  it('存下来的东西坏了就退回默认值，而不是算出 NaN 宽', () => {
    expect(clampRatio(Number('abc'))).toBe(DEFAULT_RATIO);
    expect(clampRatio(Number.NaN)).toBe(DEFAULT_RATIO);
    expect(clampRatio(Number.POSITIVE_INFINITY)).toBe(MAX_RATIO);
  });
});

describe('ratioFromPointer', () => {
  const rect = { right: 1000, width: 1000 };

  it('顾问在右：从容器右边量', () => {
    expect(ratioFromPointer(500, rect)).toBe(0.5);
    expect(ratioFromPointer(750, rect)).toBe(0.25);
    expect(ratioFromPointer(200, rect)).toBe(0.8);
  });

  it('拖出上下限时夹住', () => {
    expect(ratioFromPointer(1200, rect)).toBe(MIN_RATIO);
    expect(ratioFromPointer(-50, rect)).toBe(MAX_RATIO);
  });

  it('容器还没量到尺寸时给默认值，不除以 0', () => {
    expect(ratioFromPointer(100, { right: 0, width: 0 })).toBe(DEFAULT_RATIO);
  });
});
