import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** 短横线的条数。位置按滚动比例均分，与消息条数无关，因此多少条对话都长一样 */
const SEGMENTS = 26;
/** 轨道上下留白，必须与下方 style 中的 padding 保持一致 */
const RAIL_PADDING_PX = 16;
/** 命中一个消息时允许的容差，避免目标正好落在段落间隙里 */
const ITEM_TOLERANCE_PX = 8;

export interface RailItem {
  role: 'user' | 'assistant';
  text: string;
}

interface ConversationScrollRailProps {
  containerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  items: RailItem[];
}

interface Metrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const indexToFraction = (index: number) => index / (SEGMENTS - 1);

/**
 * 对话区的滚动条：右侧一列短横线。
 * 悬停时横线变长变实，并在左侧预览该位置的内容；点击或拖动跳转。
 * 原生滚动条被 .scrollbar-none 隐藏，滚动本身仍然照常（滚轮 / 键盘 / 触控板）。
 */
export function ConversationScrollRail({
  containerRef,
  contentRef,
  items,
}: ConversationScrollRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  const [metrics, setMetrics] = useState<Metrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });
  const [messageOffsets, setMessageOffsets] = useState<number[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setMetrics({
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    });
  }, [containerRef]);

  // 跟着滚动位置走；内容在流式输出时会长高但不一定触发 scroll，所以额外观察尺寸
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    measure();
    container.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);

    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (contentRef.current) observer.observe(contentRef.current);

    return () => {
      container.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
      observer.disconnect();
    };
  }, [containerRef, contentRef, measure, items.length]);

  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const scrollable = maxScroll > 1;
  const progress = maxScroll > 0 ? metrics.scrollTop / maxScroll : 0;
  const visibleStart = metrics.scrollHeight > 0 ? metrics.scrollTop / metrics.scrollHeight : 0;
  const visibleEnd =
    metrics.scrollHeight > 0
      ? (metrics.scrollTop + metrics.clientHeight) / metrics.scrollHeight
      : 1;

  /**
   * 每条消息在内容里的绝对纵向偏移。它不随滚动变化（基准里已经减掉 scrollTop），
   * 所以只在内容尺寸变化时重算；放在 effect 里测量，渲染期不碰 ref。
   */
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      setMessageOffsets([]);
      return;
    }

    const base = container.getBoundingClientRect().top - container.scrollTop;
    const count = Math.min(content.children.length, items.length);
    setMessageOffsets(
      Array.from(
        { length: count },
        (_, i) => (content.children[i] as HTMLElement).getBoundingClientRect().top - base
      )
    );
  }, [containerRef, contentRef, items.length, metrics.scrollHeight, metrics.clientHeight]);

  /** 某个滚动比例处最靠近顶部的消息下标 */
  const itemIndexAtFraction = (fraction: number) => {
    if (messageOffsets.length === 0) return 0;

    const target = fraction * maxScroll;
    let found = 0;
    for (let i = 0; i < messageOffsets.length; i += 1) {
      if (messageOffsets[i] <= target + ITEM_TOLERANCE_PX) found = i;
    }
    return found;
  };

  const fractionFromClientY = (clientY: number) => {
    const rail = railRef.current;
    if (!rail) return 0;
    const rect = rail.getBoundingClientRect();
    const usable = Math.max(1, rect.height - RAIL_PADDING_PX * 2);
    return clamp((clientY - rect.top - RAIL_PADDING_PX) / usable, 0, 1);
  };

  const scrollToFraction = (fraction: number) => {
    const container = containerRef.current;
    if (!container) return;
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    container.scrollTop = clamp(fraction, 0, 1) * max;
  };

  const track = (clientY: number) => {
    const fraction = fractionFromClientY(clientY);
    setHoveredIndex(Math.round(fraction * (SEGMENTS - 1)));
    setHoverY(clamp(clientY - (railRef.current?.getBoundingClientRect().top ?? 0), 0, metrics.clientHeight));
    return fraction;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    scrollToFraction(track(event.clientY));
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const fraction = track(event.clientY);
    if (dragging) scrollToFraction(fraction);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const page = container.clientHeight * 0.9;
    const step = 48;
    const deltas: Record<string, number> = {
      ArrowUp: -step,
      ArrowDown: step,
      PageUp: -page,
      PageDown: page,
    };

    if (event.key in deltas) {
      event.preventDefault();
      container.scrollTop += deltas[event.key];
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      container.scrollTop = 0;
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      container.scrollTop = container.scrollHeight;
    }
  };

  /**
   * 轨道是滚动容器的兄弟节点，滚轮落在它身上不会滚到内容，所以手动转发一次。
   * 位移不做阻尼（橡皮筋只作用于内容区）。
   */
  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;
    const delta =
      event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * container.clientHeight : event.deltaY;
    container.scrollTop += delta;
  };

  const preview =
    hoveredIndex === null || items.length === 0
      ? null
      : items[itemIndexAtFraction(indexToFraction(hoveredIndex))];

  if (!scrollable) return null;

  const isOpen = expanded || dragging;
  const previewTop = clamp(hoverY, 48, Math.max(48, metrics.clientHeight - 48));

  return (
    <>
      <div
        ref={railRef}
        role="scrollbar"
        aria-orientation="vertical"
        aria-controls="conversation-scroll"
        aria-label="对话滚动条"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        style={{ paddingTop: RAIL_PADDING_PX, paddingBottom: RAIL_PADDING_PX }}
        className={`absolute inset-y-0 right-0 z-20 flex w-4 cursor-pointer flex-col items-end justify-between rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border ${
          isOpen ? 'bg-surface/60' : ''
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerEnter={() => setExpanded(true)}
        onPointerLeave={() => {
          setExpanded(false);
          setHoveredIndex(null);
        }}
        onFocus={() => setExpanded(true)}
        onBlur={() => setExpanded(false)}
        onKeyDown={handleKeyDown}
        onWheel={handleWheel}
      >
        {Array.from({ length: SEGMENTS }, (_, index) => {
          const fraction = indexToFraction(index);
          const inView = fraction >= visibleStart - 0.001 && fraction <= visibleEnd + 0.001;
          const hovered = hoveredIndex === index;

          const width = hovered ? 'w-5' : isOpen ? 'w-3.5' : 'w-2.5';
          const tone = hovered
            ? 'bg-foreground'
            : inView
              ? 'bg-foreground/40'
              : 'bg-border';

          return (
            <span
              key={index}
              aria-hidden="true"
              className={`h-[2px] shrink-0 rounded-full transition-all duration-150 ${width} ${tone}`}
            />
          );
        })}
      </div>

      {preview && (
        <div
          className="pointer-events-none absolute right-5 z-30 w-64 -translate-y-1/2 rounded-lg border border-border bg-background px-3 py-2 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.18)]"
          style={{ top: previewTop }}
        >
          <div className="text-[10.5px] text-muted">
            {preview.role === 'user' ? '你' : 'Pi'}
          </div>
          <p className="mt-0.5 line-clamp-3 text-[12px] leading-[1.65] text-foreground/90 break-words">
            {preview.text}
          </p>
        </div>
      )}
    </>
  );
}
