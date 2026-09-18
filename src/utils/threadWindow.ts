/**
 * 对话区只渲染一段消息（默认末尾一页），更早 / 更后的按需补进来。
 * 一次渲染几百条消息时，每条都要走 markdown 解析与语法高亮，主线程会被占住，
 * 切到长会话就会卡——这才是卡顿的根源，不是调度问题。
 *
 * 窗口是**可滑动**的：既能往上补（看更早），也能往下补（看更后），还能直接定位到
 * 某一条（右侧轨道点一个还没渲染的提问）。所以除了长度，还要记住「窗口后面还剩
 * 多少条没渲染」。
 */
export const THREAD_PAGE = 50;

export interface ThreadWindow {
  /** 这段窗口属于哪一次历史；换会话后不能沿用旧的位置 */
  key: string;
  /** 渲染的条数 */
  size: number;
  /** 窗口之后还留着多少条没渲染（0 = 窗口贴到最新） */
  end: number;
}

export const initialWindow = (): ThreadWindow => ({ key: '', size: THREAD_PAGE, end: 0 });

/** 窗口的位置与长度。换过会话就回到「末尾一页」 */
export function windowFor(
  window: ThreadWindow,
  historyKey: string
): { size: number; end: number } {
  return window.key === historyKey
    ? { size: window.size, end: window.end }
    : { size: THREAD_PAGE, end: 0 };
}

/**
 * 向上补一页（看更早的消息）。
 * 只把长度加上去，尾部留白不动，于是窗口上沿往更早处扩。最多撑到最开头。
 */
export function growWindow(window: ThreadWindow, historyKey: string, total: number): ThreadWindow {
  const { size, end } = windowFor(window, historyKey);
  const endIndex = Math.max(0, total - end);
  return { key: historyKey, size: Math.max(1, Math.min(size + THREAD_PAGE, endIndex)), end };
}

/**
 * 向下补一页（看更后的消息）。
 * 长度与尾部留白一起变，窗口上沿保持不动，只在下面接一段。
 */
export function loadLater(window: ThreadWindow, historyKey: string): ThreadWindow {
  const { size, end } = windowFor(window, historyKey);
  const nextEnd = Math.max(0, end - THREAD_PAGE);
  return { key: historyKey, size: size + (end - nextEnd), end: nextEnd };
}

/**
 * 让某一条落进窗口（右侧轨道点了一个还没渲染的提问）。
 * 把它放到窗口开头，前后各留一页的量。
 */
export function windowAround(
  historyKey: string,
  total: number,
  index: number
): ThreadWindow {
  const target = Math.max(0, Math.min(index, Math.max(0, total - 1)));
  const end = Math.max(0, total - target - THREAD_PAGE);
  return { key: historyKey, size: THREAD_PAGE, end };
}

export interface WindowSlice<T> {
  /** 窗口在整段消息里的起点（含） */
  startIndex: number;
  /** 窗口在整段消息里的终点（不含） */
  endIndex: number;
  visible: T[];
  /** 前面还有没渲染的 */
  hasEarlier: boolean;
  /** 后面还有没渲染的 */
  hasLater: boolean;
}

/** 根据窗口算出实际要渲染的那一段 */
export function visibleSlice<T>(
  all: T[],
  window: ThreadWindow,
  historyKey: string
): WindowSlice<T> {
  const { size, end } = windowFor(window, historyKey);
  const endIndex = Math.max(0, all.length - end);
  const startIndex = Math.max(0, endIndex - size);

  return {
    startIndex,
    endIndex,
    visible: all.slice(startIndex, endIndex),
    hasEarlier: startIndex > 0,
    hasLater: endIndex < all.length,
  };
}
