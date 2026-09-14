/**
 * 对话区只渲染最近的一段消息，更早的按需补进来（参考官方 pi-web 的做法）。
 * 一次渲染几百条消息时，每条都要走 markdown 解析与语法高亮，主线程会被占住，
 * 切到长会话就会卡——这才是卡顿的根源，不是调度问题。
 */
export const THREAD_PAGE = 50;

export interface ThreadWindow {
  /** 这段窗口属于哪一次历史；换会话后不能沿用旧的展开量 */
  key: string;
  size: number;
}

export const initialWindow = (): ThreadWindow => ({ key: '', size: THREAD_PAGE });

/** 换过会话就回到默认窗口，否则沿用当前展开量 */
export function windowSizeFor(window: ThreadWindow, historyKey: string): number {
  return window.key === historyKey ? window.size : THREAD_PAGE;
}

/** 向上补一页，最多不超过实际条数 */
export function growWindow(
  window: ThreadWindow,
  historyKey: string,
  total: number
): ThreadWindow {
  const next = windowSizeFor(window, historyKey) + THREAD_PAGE;
  return { key: historyKey, size: Math.min(next, Math.max(total, 1)) };
}

/** 根据窗口算出实际要渲染的那一段（只要末尾若干条） */
export function visibleSlice<T>(
  all: T[],
  window: ThreadWindow,
  historyKey: string
): { startIndex: number; visible: T[]; hasEarlier: boolean } {
  const size = windowSizeFor(window, historyKey);
  const startIndex = Math.max(0, all.length - size);
  return {
    startIndex,
    visible: all.slice(startIndex),
    hasEarlier: startIndex > 0,
  };
}
