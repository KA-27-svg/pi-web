import { useEffect, useState } from 'react';

/**
 * 「刚打开」这个窗口开多久。
 *
 * 里面几段动画的长度：分栏线画下来 460ms、按钮涟漪 620ms、光带扫过 700ms。
 * 取最长的那个再留一帧余量——留余量是因为动画从下一帧才真正开始（
 * 实测 animationstart 在 click 后约 16ms），卡着 700ms 摘类会把光带最后几帧切掉。
 */
export const OPENING_MS = 760;

/**
 * 助手模式「刚打开」的那一下。只在 false → true 时为真，OPENING_MS 之后自己落回去。
 *
 * 用它的地方：顾问栏铺进来、分栏线画下来、开关按钮泛一圈涟漪。
 *
 * 为什么要有个窗口、而不是把 CSS 动画一直挂在元素上：动画用了
 * `animation-fill-mode: both`，播完元素上仍然留着 transform，而面板里
 * 有 `position: fixed` 的元素（输入框的菜单遮罩），只要有 transform，
 * 它们的参照系就从视口变成这个祖先。窗口一过就把类摘掉，就没有这回事。
 *
 * 页面加载时不算「刚打开」：localStorage 里存着「开着」时，一进来就演一遍动画
 * 很怪，那时候界面本来就在那儿。
 */
export function useAssistantOpening(enabled: boolean, duration: number = OPENING_MS): boolean {
  const [opening, setOpening] = useState(false);
  const [previous, setPrevious] = useState(enabled);

  // 从关到开：当场为真（不等 effect，少一帧的闪）；关掉当场收回。
  // 这是 React 官方的「props 变了就顺手改一下 state」写法，比在 effect 里
  // setState 少一轮渲染，也不会被 lint 拦。
  if (previous !== enabled) {
    setPrevious(enabled);
    setOpening(enabled);
  }

  useEffect(() => {
    if (!opening) return;
    const timer = setTimeout(() => setOpening(false), duration);
    return () => clearTimeout(timer);
  }, [opening, duration]);

  return opening;
}
