import { useCallback, useEffect, useRef, useState } from 'react';

export type RefreshPhase = 'idle' | 'pending' | 'done';

/**
 * 转圈至少停这么久，哪怕数据已经回来了。
 *
 * `list_sessions` 有时几十毫秒就回来了，不兜一下的话点下去直接跳到对勾，
 * 看起来就像根本没在刷新。
 */
const MIN_PENDING_MS = 500;

/** 「已刷新 / 已保存」停多久。太快了看不见，太久了像卡住 */
const DONE_VISIBLE_MS = 1200;

/** 兜底：请求一直没回来也要把转圈停掉，否则按钮永远在转 */
const GIVE_UP_MS = 8000;

/**
 * 「点一下 → 转圈 → 完成」的反馈。刷新按钮和保存按钮共用。
 *
 * 以前这些按钮点了什么都不变：请求发出去了、数据也回来了，但内容没变的话，重渲染出来
 * 是同一幅画面——用户不知道到底点上没有。
 *
 * 做法：按下去先转圈，等 `signal` 换了对象（说明数据真回来了）再停，并短暂显示完成。
 *
 * 为什么盯 `signal` 而不是定时：定时是在假装知道什么时候刷完。这几个请求确实每次都会
 * 回一个新对象（桥接那边 `sessions: data.sessions ?? []`、`setup` 都是新建的），所以
 * 能如实判断。万一对端出了问题一个包都不回，`GIVE_UP_MS` 兜底。
 *
 * 动作在 `trigger` 里传而不是构造时传：这样调用方不用在「构造函数里引用后面才声明的
 * 那个东西」，也就没有循环引用（oxlint 的 react/immutability 会盯这个）。
 *
 * @param signal 完成后会换引用的那个值（`status.sessions` / `status.setup`）
 */
export function useRefreshFeedback<T>(signal: T) {
  const [phase, setPhase] = useState<RefreshPhase>('idle');
  /** 点下去那一刻的 signal。之后它换了对象，就说明这一轮回来了 */
  const signalAtClickRef = useRef<T>(signal);
  /** 点下去的时刻，用来算转圈够不够久 */
  const clickedAtRef = useRef(0);

  const trigger = useCallback(
    (work: () => void | Promise<void>) => {
      signalAtClickRef.current = signal;
      clickedAtRef.current = Date.now();
      setPhase('pending');

      // 动作本身失败就别等 signal 了——那会报一个假的「已刷新 / 已保存」。
      // 同步抛和 async 拒绝都要接住，所以两种都处理。
      try {
        const result = work();
        if (result instanceof Promise) result.catch(() => setPhase('idle'));
      } catch {
        setPhase('idle');
      }
    },
    [signal]
  );

  useEffect(() => {
    if (phase !== 'pending') return;

    const settle = () => setPhase('done');

    if (signal !== signalAtClickRef.current) {
      // 数据回来了。但转圈得让人看得见，不够久就再等一会儿
      const remaining = MIN_PENDING_MS - (Date.now() - clickedAtRef.current);
      if (remaining <= 0) {
        settle();
        return;
      }
      const timer = window.setTimeout(settle, remaining);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(settle, GIVE_UP_MS);
    return () => window.clearTimeout(timer);
  }, [phase, signal]);

  useEffect(() => {
    if (phase !== 'done') return;
    const timer = window.setTimeout(() => setPhase('idle'), DONE_VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  return { phase, trigger };
}
