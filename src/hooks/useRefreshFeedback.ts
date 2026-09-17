import { useCallback, useEffect, useRef, useState } from 'react';

export type RefreshPhase = 'idle' | 'pending' | 'done';

/** 「已刷新」停多久。太快了看不见，太久了像卡住 */
const DONE_VISIBLE_MS = 1200;

/** 兜底：请求一直没回来也要把转圈停掉，否则按钮永远在转 */
const GIVE_UP_MS = 8000;

/**
 * 刷新按钮的点击反馈。
 *
 * 侧栏的历史对话刷新和环境自检的「重新检测」以前点了什么都不变：请求是发出去了，
 * 但列表没变的话重渲染出来是同一幅画面，用户不知道到底点上没有。
 *
 * 现在按下去先转圈，等 `signal` 换了对象（说明数据真回来了）再停，并短暂显示
 * 「已刷新」。
 *
 * 为什么盯 `signal` 而不是定时：定时是在假装知道什么时候刷完。这两个请求确实每次
 * 都会回一个新对象（桥接那边 `sessions: data.sessions ?? []`、`setup` 都是新建的），
 * 所以能如实判断。万一对端出了问题一个包都不回，`GIVE_UP_MS` 兜底。
 *
 * @param signal 刷新完成后会换引用的那个值（`status.sessions` / `status.setup`）
 */
export function useRefreshFeedback<T>(signal: T, onRefresh: () => void) {
  const [phase, setPhase] = useState<RefreshPhase>('idle');
  /** 点下去那一刻的 signal。之后它换了对象，就说明这一轮回来了 */
  const signalAtClickRef = useRef<T>(signal);

  const trigger = useCallback(() => {
    signalAtClickRef.current = signal;
    setPhase('pending');
    onRefresh();
  }, [onRefresh, signal]);

  useEffect(() => {
    if (phase !== 'pending') return;

    if (signal !== signalAtClickRef.current) {
      setPhase('done');
      return;
    }

    const timer = window.setTimeout(() => setPhase('done'), GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [phase, signal]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = window.setTimeout(() => setPhase('idle'), DONE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return { phase, trigger };
}
