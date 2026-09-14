import { useEffect, type RefObject } from 'react';

interface RubberBandOptions {
  /** 关闭时不启用（例如还没有任何消息可滚） */
  enabled?: boolean;
  /** 最大位移（px）。实际位移以它为渐近线，不会到达 */
  maxOffset?: number;
  /** 每 1px 滚轮量转化成多少拉动量 */
  resistance?: number;
  /** 停止滚轮多久后回弹（ms） */
  releaseDelay?: number;
  /** 回弹时长（ms） */
  releaseDuration?: number;
}

// 拉动过程中给 transform 一个短过渡，让每次滚轮之间平滑衔接而不是跳变
const PULL_TRANSITION = 'transform 110ms ease-out';
// 回弹用不带过冲的缓出，与本项目「不弹跳」的动效基调一致
const RELEASE_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const LINE_HEIGHT_PX = 16;

/**
 * 阻尼后的视觉位移。raw 很小时接近 1:1，越大越沉，|结果| 恒小于 maxOffset。
 */
export function rubberBandOffset(raw: number, maxOffset: number): number {
  return raw / (1 + Math.abs(raw) / maxOffset);
}

/**
 * 判断这次滚轮该不该走回弹：
 *  1 = 已在底部仍往下拉，-1 = 已在顶部仍往上拉，0 = 正常滚动。
 * 内容不足以滚动时首尾同时成立，两个方向都能拉。
 */
export function overscrollDirection(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  delta: number
): 0 | 1 | -1 {
  if (delta === 0) return 0;
  if (delta > 0) {
    return metrics.scrollTop + metrics.clientHeight >= metrics.scrollHeight - 1 ? 1 : 0;
  }
  return metrics.scrollTop <= 0 ? -1 : 0;
}

/**
 * 在滚动容器到达边界后，把滚轮的继续滚动转成内容位移（橡皮筋），松手回弹。
 *
 * 只监听 wheel：拖动滚动条不会产生 wheel 事件，因此天然不受影响；
 * 同时内容内部的滚动区域（代码块、工具输出）还有余量时，把滚动让给它们。
 */
export function useRubberBandScroll(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  {
    enabled = true,
    maxOffset = 120,
    resistance = 0.4,
    releaseDelay = 120,
    releaseDuration = 480,
  }: RubberBandOptions = {}
) {
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!enabled || !container || !content) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // raw 可以涨到 maxOffset 的数倍，但位移会饱和，所以再拉也不会拉飞
    const maxRaw = maxOffset * 4;
    let raw = 0;
    let releaseTimer: number | undefined;

    const paint = () => {
      const offset = rubberBandOffset(raw, maxOffset);
      content.style.transition = PULL_TRANSITION;
      content.style.transform = `translateY(${-offset}px)`;
    };

    const release = () => {
      window.clearTimeout(releaseTimer);
      releaseTimer = undefined;
      raw = 0;
      content.style.transition = `transform ${releaseDuration}ms ${RELEASE_EASING}`;
      content.style.transform = 'translateY(0px)';
    };

    /** 事件目标到容器之间是否还有能吃下这次滚动的内部滚动区 */
    const innerScrollerConsumes = (target: EventTarget | null, delta: number) => {
      let node: HTMLElement | null = target instanceof HTMLElement ? target : null;
      while (node && node !== container) {
        const { overflowY } = getComputedStyle(node);
        if (overflowY === 'auto' || overflowY === 'scroll') {
          if (delta > 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1) return true;
          if (delta < 0 && node.scrollTop > 0) return true;
        }
        node = node.parentElement;
      }
      return false;
    };

    const onWheel = (event: WheelEvent) => {
      // ctrl+滚轮是缩放，不要截胡
      if (event.ctrlKey || event.deltaY === 0) return;

      // 不同浏览器/设备用不同单位报 deltaY，统一折算成像素
      const delta =
        event.deltaMode === 1
          ? event.deltaY * LINE_HEIGHT_PX
          : event.deltaMode === 2
            ? event.deltaY * container.clientHeight
            : event.deltaY;
      if (delta === 0) return;

      const direction = overscrollDirection(container, delta);
      if (direction === 0 || innerScrollerConsumes(event.target, delta)) {
        // 已经回到可滚动范围：把残留位移收回，并交还原生滚动
        if (raw !== 0) release();
        return;
      }

      event.preventDefault();

      // 反向拉动时从 0 重新计，不允许把内容拉向另一侧
      if (raw !== 0 && Math.sign(raw) !== direction) raw = 0;
      raw = Math.max(-maxRaw, Math.min(maxRaw, raw + delta * resistance));
      if (raw * direction < 0) raw = 0;

      paint();

      window.clearTimeout(releaseTimer);
      releaseTimer = window.setTimeout(release, releaseDelay);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      container.removeEventListener('wheel', onWheel);
      window.clearTimeout(releaseTimer);
      raw = 0;
      content.style.transition = '';
      content.style.transform = '';
    };
  }, [containerRef, contentRef, enabled, maxOffset, resistance, releaseDelay, releaseDuration]);
}
