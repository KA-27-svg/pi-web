/** 顾问那一栏的宽度占比：下限 / 上限 / 默认 */
export const MIN_RATIO = 0.2;
export const MAX_RATIO = 0.8;
export const DEFAULT_RATIO = 0.5;

export function clampRatio(value: number, min = MIN_RATIO, max = MAX_RATIO): number {
  // 只有 NaN 无法用：Infinity 夹一下就变成上限，不用特殊处理
  if (Number.isNaN(value)) return DEFAULT_RATIO;
  return Math.min(max, Math.max(min, value));
}

/**
 * 指针位置 → 顾问那一栏该占多宽。
 *
 * 顾问在右边，所以从容器右边量。夹在 [MIN, MAX] 之间：不然能把某一栏拖到 0 宽，
 * 看起来就像那个 pane 崩了。
 */
export function ratioFromPointer(
  clientX: number,
  rect: { right: number; width: number },
  min = MIN_RATIO,
  max = MAX_RATIO
): number {
  if (!(rect.width > 0)) return DEFAULT_RATIO;
  return clampRatio((rect.right - clientX) / rect.width, min, max);
}
