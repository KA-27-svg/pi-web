/** 上下文占用档位。50 / 80 / 100 三档，对应三个提示级别。 */
export type ContextLevel = 'ok' | 'half' | 'high' | 'full';

/**
 * 把上下文占用百分比换算成档位。
 *
 * 压缩之后 pi 会短暂给出 `null`（还没有新的用量数据），这时按「正常」处理，
 * 不要凭空弹一个「已满」。
 */
export function contextLevel(percent: number | null | undefined): ContextLevel {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 'ok';
  if (percent >= 100) return 'full';
  if (percent >= 80) return 'high';
  if (percent >= 50) return 'half';
  return 'ok';
}

/** 该档位下给用户的一句话。正常档返回 null（不提示） */
export function contextLevelText(level: ContextLevel, percent?: number | null): string | null {
  const shown = typeof percent === 'number' && Number.isFinite(percent) ? `${Math.round(percent)}%` : '—';

  switch (level) {
    case 'half':
      return `上下文已用 ${shown}，超过一半了，可以压缩一下`;
    case 'high':
      return `上下文已用 ${shown}，快到上限了`;
    case 'full':
      return `上下文已用 ${shown}，已经满了，建议马上压缩`;
    default:
      return null;
  }
}
