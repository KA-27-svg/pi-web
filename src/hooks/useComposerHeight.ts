import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** 单行时外壳的高度 */
const COMPOSER_MIN_HEIGHT = 53;
/** 长高的上限，与 textarea 的 max-h-48 保持一致 */
const COMPOSER_MAX_HEIGHT = 192;
/** 开场形变时长，覆盖 CSS 里最长的过渡 */
const MORPH_MS = 760;

interface ComposerHeightOptions {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  stageRef: RefObject<HTMLDivElement | null>;
  /** 图标态：外壳是 112px 的圆，测量要走另一条分支 */
  showIcon: boolean;
  /** 输入内容，变了就重测 */
  value: string;
  /** 外壳高度真的变化时通知父级，便于贴底时重新对齐滚动位置 */
  onResize?: () => void;
}

/**
 * 输入框外壳的高度自适应，以及开场形变期间的特殊处理。
 *
 * 单独拆出来是因为这里的坑最密：形变窗口、scrollHeight 必须复位、ResizeObserver
 * 要按宽度判断。混在组件里会把「打字 / 发送」的主干逻辑彻底埋掉。
 */
export function useComposerHeight({
  textareaRef,
  stageRef,
  showIcon,
  value,
  onResize,
}: ComposerHeightOptions) {
  /** 上一次真正应用到外壳的高度，用来跳过无变化的写入 */
  const appliedHeightRef = useRef(0);

  const measure = useCallback(() => {
    const el = textareaRef.current;
    const stage = stageRef.current;
    if (!el || !stage) return;

    let height: number;
    if (stage.hasAttribute('data-morphing')) {
      /*
       * 图标态与形变期间外壳只有 112px 宽，减去左右内边距后文字区不到 50px，
       * 占位文字会被折成好几行，scrollHeight 直接顶到上限；而这段时间输入必定为空，
       * 正确高度就是单行高度。顺便也省掉一次强制布局（形变时 width 每帧都在变）。
       */
      height = COMPOSER_MIN_HEIGHT;
    } else {
      // 必须先把高度复位到 auto，否则 scrollHeight 会被当前高度撑住，收回时量不准
      el.style.height = 'auto';
      height = Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT), COMPOSER_MAX_HEIGHT);
    }
    // 总是写回，避免上面探针留在 auto 上把文字区收空
    el.style.height = `${height}px`;

    // 外壳高度会连带压缩整个对话区，所以只在真的变化时才写，
    // 否则开场形变期间每帧一次会让动画直接卡住
    if (height === appliedHeightRef.current) return;
    appliedHeightRef.current = height;

    stage.style.setProperty('--composer-height', `${height}px`);
    onResize?.();
  }, [textareaRef, stageRef, onResize]);

  /**
   * 形变窗口：图标态一直处于窗口内；展开后再持续一小段。
   * 必须在 measure 之后声明，因为窗口结束时要用它补测一次。
   */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    if (showIcon) {
      stage.setAttribute('data-morphing', 'true');
      return;
    }
    const timer = window.setTimeout(() => {
      stage.removeAttribute('data-morphing');
      // 形变期间不测量，结束后补一次，覆盖期间可能已经输入的内容
      measure();
    }, MORPH_MS);
    return () => window.clearTimeout(timer);
  }, [showIcon, stageRef, measure]);

  useEffect(() => {
    measure();
  }, [value, measure]);

  // 宽度变化时重新自适应：开场图标态外壳很窄，会让占位文字折行得到错误高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      measure();
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [textareaRef, measure]);

  return measure;
}
