import { describe, expect, it } from 'vitest';
import { win32 } from 'node:path';
import { formatCost, formatRelativeTime, formatTokens, projectName, remainingDays } from '../utils/format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);

  it('一分钟内算刚刚', () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
  });

  it('按分钟 / 小时 / 天递进', () => {
    expect(formatRelativeTime(now - 5 * MINUTE, now)).toBe('5 分钟前');
    expect(formatRelativeTime(now - 3 * HOUR, now)).toBe('3 小时前');
    expect(formatRelativeTime(now - 3 * DAY, now)).toBe('3 天前');
  });

  it('昨天单独说，七天以上给日期', () => {
    expect(formatRelativeTime(now - 1 * DAY, now)).toBe('昨天');
    expect(formatRelativeTime(now - 20 * DAY, now)).toMatch(/\d+月\d+日/);
  });
});

describe('projectName', () => {
  it('取工作目录的最后一段', () => {
    expect(projectName('C:/work/alpha')).toBe('alpha');
  });

  it('Windows 反斜杠路径同样能取到', () => {
    // 用 win32.join 构造，避免在源码里写转义反斜杠
    const windowsPath = win32.join('C:', 'Users', 'me', 'Desktop', 'pi web');
    expect(windowsPath).toContain('\\');
    expect(projectName(windowsPath)).toBe('pi web');
  });

  it('目录结尾多了分隔符也不受影响', () => {
    expect(projectName('C:/work/alpha/')).toBe('alpha');
  });

  it('没有 cwd 时返回 undefined', () => {
    expect(projectName(undefined)).toBeUndefined();
    expect(projectName('')).toBeUndefined();
  });
});

describe('remainingDays', () => {
  const now = Date.UTC(2026, 8, 14, 12, 0, 0);

  it('向上取整，不显示 0 天', () => {
    expect(remainingDays(now + 1 * DAY, now)).toBe(1);
    expect(remainingDays(now + 1.5 * DAY, now)).toBe(2);
    expect(remainingDays(now + 1000, now)).toBe(1);
  });

  it('已过期不会出现负数', () => {
    expect(remainingDays(now - 5 * DAY, now)).toBe(0);
  });
});

describe('formatCost', () => {
  it('小额保留 4 位，否则一次对话只显示 $0.00', () => {
    // 实测一轮 deepseek-flash 大约 $0.0041，两位小数就看不见了
    expect(formatCost(0.00413724)).toBe('$0.0041');
  });

  it('一元以下保留 3 位', () => {
    expect(formatCost(0.456)).toBe('$0.456');
  });

  it('常规金额保留 2 位', () => {
    expect(formatCost(1.2345)).toBe('$1.23');
  });

  it('零与非法值都给 $0.00，不显示 NaN', () => {
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(-1)).toBe('$0.00');
    expect(formatCost(Number.NaN)).toBe('$0.00');
  });
});

describe('formatTokens', () => {
  it('一千以下原样显示', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(999)).toBe('999');
  });

  it('千位保留一位小数', () => {
    expect(formatTokens(7274)).toBe('7.3k');
  });

  it('十万位不再带小数，避免宽度跳动', () => {
    expect(formatTokens(191028)).toBe('191k');
  });

  it('百万位保留两位', () => {
    expect(formatTokens(1_234_567)).toBe('1.23M');
  });
});
