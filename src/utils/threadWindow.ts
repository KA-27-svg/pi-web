/**
 * 对话区只渲染一段消息（默认末尾一页），更早 / 更后的按需补进来。
 * 一次渲染几百条消息时，每条都要走 markdown 解析与语法高亮，主线程会被占住，
 * 切到长会话就会卡——这才是卡顿的根源，不是调度问题。
 *
 * 窗口是**可滑动**的：既能往上补（看更早），也能往下补（看更后），还能直接定位到
 * 某一条（右侧轨道点一个还没渲染的提问）。所以除了长度，还要记住「窗口后面还剩
 * 多少条没渲染」。
 *
 * 长度单位不是「条数」而是「体量」（见 `messageWeight`）：同一回合的多条 assistant
 * 消息会被合并成一条，而合并后的一条可能带着几十个工具卡。实测一个会话的末尾 50 条
 * 能挂上 338 个工具卡，光看条数限不住渲染量，所以用体量做预算。
 */
export const THREAD_PAGE = 50;

/**
 * 一条消息的渲染体量。工具卡与附件是 DOM 大头，各算一份；消息本身算 1。
 * 纯聊天（没有工具/附件）时每条都是 1，与按条数算完全一致。
 */
export function messageWeight(message: {
  tools?: unknown[];
  attachments?: unknown[];
}): number {
  return 1 + (message.tools?.length ?? 0) + (message.attachments?.length ?? 0);
}

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
 * 一段历史的总体量。
 *
 * 窗口的上限得按**体量**算，不能按条数：一条挂了几十个工具卡的消息抵得上
 * 几十条普通消息，按条数封顶的话窗口加到「条数」就再也长不动了，而那个数
 * 只够装几条——用户往上滚两下就卡住，更早的对话永远翻不到。
 *
 * 返回的是个数字，方便调用方塞进 useMemo：窗口的补页回调要能被 memo 稳住，
 * 否则流式输出时每来一个 delta 都会把哨兵观察器重建一遍。
 */
export function historyWeight<T>(
  all: T[],
  weight: (item: T) => number = () => 1
): number {
  let total = 0;
  for (const item of all) total += weight(item);
  return total;
}

/**
 * 向上补一页（看更早的消息）。
 * 只把长度加上去，尾部留白不动，于是窗口上沿往更早处扩。最多撑到最开头。
 */
export function growWindow(
  window: ThreadWindow,
  historyKey: string,
  availableWeight: number
): ThreadWindow {
  const { size, end } = windowFor(window, historyKey);
  return {
    key: historyKey,
    size: Math.max(1, Math.min(size + THREAD_PAGE, availableWeight)),
    end,
  };
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
 * 把它放到窗口开头，后面留一页体量的内容（这样跳过去能看到它下面的回答）。
 */
export function windowAround<T>(
  historyKey: string,
  all: T[],
  index: number,
  weight: (item: T) => number = () => 1
): ThreadWindow {
  const target = Math.max(0, Math.min(index, Math.max(0, all.length - 1)));
  const targetWeight = weight(all[target]);

  // 目标之后留一页：累计到一页的体量为止（目标自己已占掉一部分）
  const afterBudget = Math.max(0, THREAD_PAGE - targetWeight);
  let afterIndex = target + 1;
  let after = 0;
  while (afterIndex < all.length && after < afterBudget) {
    after += weight(all[afterIndex]);
    afterIndex += 1;
  }

  // end 是「窗口之后」的体量；size 要盖住目标自己加它后面那段
  let end = 0;
  for (let i = afterIndex; i < all.length; i += 1) end += weight(all[i]);

  return { key: historyKey, size: targetWeight + after, end };
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

/** 根据窗口算出实际要渲染的那一段。`weight` 与 `messageWeight` 对应 */
export function visibleSlice<T>(
  all: T[],
  window: ThreadWindow,
  historyKey: string,
  weight: (item: T) => number = () => 1
): WindowSlice<T> {
  const { size, end } = windowFor(window, historyKey);

  // end：从末尾往前累计到该体量为止，这一段不渲染（滑动窗口留在后面的部分）
  let endIndex = all.length;
  let acc = 0;
  while (endIndex > 0 && acc < end) {
    endIndex -= 1;
    acc += weight(all[endIndex]);
  }

  // size：再从 endIndex 往前累计一页体量，这段才是要渲染的
  let startIndex = endIndex;
  acc = 0;
  while (startIndex > 0 && acc < size) {
    startIndex -= 1;
    acc += weight(all[startIndex]);
  }

  return {
    startIndex,
    endIndex,
    visible: all.slice(startIndex, endIndex),
    hasEarlier: startIndex > 0,
    hasLater: endIndex < all.length,
  };
}
