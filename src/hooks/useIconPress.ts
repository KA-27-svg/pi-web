import { useCallback, useEffect, useRef, useState } from 'react';

export interface IconPress {
  /** 动画窗口内为真：为真时给按钮挂上动画类 */
  active: boolean;
  /**
   * 每次点击自增，用作图标元素的 `key`。
   *
   * 有了它，连着点两下也能各演一遍：`active` 第二下本来就是 true，React 不会重渲染，
   * 动画也就不会重播；而 `key` 一变，图标元素被重建，新元素匹配到动画规则就是从头播。
   * 挂在图标上而不是按钮上，是为了别把按钮本身重建掉（会丢焦点）。
   */
  count: number;
  /** 点击时调用 */
  press: () => void;
}

/**
 * 点击图标时演一下，演完自己落回。
 *
 * 为什么要有「窗口」、而不是把动画类一直挂在元素上：动画带
 * `animation-fill-mode: both`，播完元素上仍然留着属性值。窗口一过就摘类，
 * 元素回到干净的基础态。
 *
 * 为什么由点击事件触发、而不是盯状态变化（助手模式一开始那版就是盯状态）：图标动画
 * 只该跟着手指走。盯状态的话，页面加载时（localStorage 里存着「开着」）会莫名其妙
 * 演一遍，别人改状态也会误触发。
 *
 * `duration` 要盖住这类里最长的那段动画——CSS 里的毫秒数改了就跟着改这里，
 * 摘早了会把动画尾巴切掉。
 */
export function useIconPress(duration: number): IconPress {
  const [active, setActive] = useState(false);
  const [count, setCount] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const press = useCallback(() => {
    // 窗口内又点了一下：定时器从头数，别让上一次的尾巴把这一遍掐断
    if (timerRef.current) clearTimeout(timerRef.current);
    setActive(true);
    setCount(n => n + 1);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setActive(false);
    }, duration);
  }, [duration]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  return { active, count, press };
}
