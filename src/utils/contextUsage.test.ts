import { describe, expect, it } from 'vitest';
import { contextLevel, contextLevelText } from './contextUsage';

describe('contextLevel', () => {
  it('49 正常，50 / 80 / 100 各进一档', () => {
    expect(contextLevel(0)).toBe('ok');
    expect(contextLevel(49.9)).toBe('ok');
    expect(contextLevel(50)).toBe('half');
    expect(contextLevel(79.9)).toBe('half');
    expect(contextLevel(80)).toBe('high');
    expect(contextLevel(99.9)).toBe('high');
    expect(contextLevel(100)).toBe('full');
    expect(contextLevel(130)).toBe('full');
  });

  it('压缩后短暂没有数据（null / undefined）时算正常，不误报已满', () => {
    expect(contextLevel(null)).toBe('ok');
    expect(contextLevel(undefined)).toBe('ok');
    expect(contextLevel(Number.NaN)).toBe('ok');
  });
});

describe('contextLevelText', () => {
  it('正常档不提示', () => {
    expect(contextLevelText('ok', 10)).toBeNull();
  });

  it('三档各有一句话，并带上百分比', () => {
    expect(contextLevelText('half', 52)).toContain('52%');
    expect(contextLevelText('high', 83)).toContain('83%');
    expect(contextLevelText('full', 100)).toContain('100%');
  });

  it('没有百分比时不写一个假的数字', () => {
    expect(contextLevelText('half', null)).toContain('—');
  });
});
