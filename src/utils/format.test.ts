import { describe, expect, it } from 'vitest';
import { win32 } from 'node:path';
import { formatRelativeTime, projectName, remainingDays } from '../utils/format';

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
