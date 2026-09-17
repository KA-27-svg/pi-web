import type { BridgeStatus } from '../types/pi';

/**
 * 供应商的显示名。三级回退：
 *
 * 1. 用户自己起的名字（存在 pi 的 `models.json` 里，pi 那边也认）
 * 2. 内置目录里的官方名（桥接下发的 `providers`）
 * 3. 兜底用 id——至少不会是一片空白
 */
export function providerLabel(status: BridgeStatus, id: string): string {
  return (
    status.providerNames?.[id] ??
    status.providers?.find(preset => preset.id === id)?.label ??
    id
  );
}
