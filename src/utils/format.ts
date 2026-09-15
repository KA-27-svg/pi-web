const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** 会话列表里的相对时间 */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const elapsed = now - timestamp;
  if (elapsed < MINUTE_MS) return '刚刚';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} 分钟前`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} 小时前`;

  const days = Math.floor(elapsed / DAY_MS);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 会话跨项目展示，用工作目录的最后一段做项目名 */
export function projectName(cwd?: string): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1];
}

/**
 * 会话花费（美元）。金额往往很小——一轮对话大约 $0.004——两位小数会直接显示成 $0.00。
 */
export function formatCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0.00';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Token 数。十万位以上不再带小数，否则每轮数字宽度都在跳。 */
export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count < 1_000) return String(Math.round(count));
  if (count < 100_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(2)}M`;
}

/** 回收箱条目的剩余保留天数，向上取整 */
export function remainingDays(expiresAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((expiresAt - now) / DAY_MS));
}
