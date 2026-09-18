import { memo, useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** 轨道上下留白，必须与下方 style 中的 padding 保持一致 */
const RAIL_PADDING_PX = 16;
/** 短横线高度 */
const DASH_HEIGHT_PX = 2;
/** 条数很少时的最大间距，让它们看起来是散开的一列而不是挤成一团 */
const DASH_GAP_MAX_PX = 16;
/** 间距压到这个值以下就不再把每条画成横线，改成整条滑动条 */
const DASH_GAP_MIN_PX = 1.5;
/** 滑动条滑块的最小高度，太短了抓不住 */
const THUMB_MIN_PX = 24;

export interface RailItem {
  /** 该条在消息列表里的下标，用来量它在内容里的纵向位置 */
  index: number;
  /** 预览文本，即用户输入原文 */
  text: string;
}

interface ConversationScrollRailProps {
  containerRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  items: RailItem[];
  /**
   * 渲染窗口的标识。items 现在是整段会话（不随窗口变），所以窗口滑动时必须
   * 靠它把锚点重算一遍。
   */
  windowKey?: string | number;
  /** 点到还没渲染的提问：请上层把窗口滑到它 */
  onNeedRender?: (absoluteIndex: number) => void;
  /** 对话滚动容器的 id（页面上现在有两个 pane，不能都叫同一个名字） */
  scrollId?: string;
}

interface Metrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * 那一列横线。单独 memo 出来是因为它**不依赖滚动位置 / 容器尺寸**
 * （间距写在轨道容器的 style 上）：不这么做的话，滚动和 composer 过渡时容器
 * 每帧触发一次 setMetrics，整列横线（可能上百条）就跟着每帧重渲染。
 */
const RailDashes = memo(function RailDashes({
  items,
  hoveredIndex,
  isOpen,
}: {
  items: RailItem[];
  hoveredIndex: number | null;
  isOpen: boolean;
}) {
  return (
    <>
      {items.map((item, index) => {
        const hovered = hoveredIndex === index;
        const width = hovered ? 'w-5' : isOpen ? 'w-3.5' : 'w-2.5';
        const tone = hovered ? 'bg-foreground' : 'bg-muted';

        return (
          <span
            key={item.index}
            data-part="dash"
            aria-hidden="true"
            className={`h-[2px] shrink-0 rounded-full transition-all duration-150 ${width} ${tone}`}
          />
        );
      })}
    </>
  );
});

/**
 * 对话区右侧的滚动指示，一条对应一次用户输入，有三种形态：
 *   1. 提问少 → 一列散开的短横线，悬停预览该次输入，点击跳过去；
 *   2. 提问变多 → 间距自动收紧，越来越密；
 *   3. 密到画不下 → 变成一整条带滑块的滑动条。
 * 原生滚动条被 .scrollbar-none 隐藏，滚动本身仍然照常（滚轮 / 键盘 / 触控板）。
 */
function ConversationScrollRailBase({
  containerRef,
  contentRef,
  items,
  windowKey,
  onNeedRender,
  scrollId = 'conversation-scroll',
}: ConversationScrollRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  const [metrics, setMetrics] = useState<Metrics>({
    scrollTop: 0,
    scrollHeight: 0,
    clientHeight: 0,
  });
  /** 每一条对应的纵向偏移；没渲染出来的那一条是 undefined */
  const [anchors, setAnchors] = useState<Array<number | undefined>>([]);
  /** 等窗口滑过来的目标（绝对下标）；渲染好之后就滚过去 */
  const pendingIndexRef = useRef<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [hoverY, setHoverY] = useState(0);

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const next = {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
    // 值没变必须返回原对象：下面是「每次渲染后都测」，否则会无休止地重渲染
    setMetrics(prev =>
      prev.scrollTop === next.scrollTop &&
      prev.scrollHeight === next.scrollHeight &&
      prev.clientHeight === next.clientHeight
        ? prev
        : next
    );
  }, [containerRef]);

  /**
   * 每次渲染后合并到下一帧测一次。新对话挂载时内容还很短，全靠事后发现它长高；
   * 只依赖 ResizeObserver 的话，一旦它没触发（或观察的元素不对）轨道就永远不出现。
   * 用 rAF 合并是因为流式输出一帧可能要渲染很多次，逐次测量会反复强制布局。
   */
  useEffect(() => {
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  });

  // 跟着滚动位置走，并监听窗口尺寸；内容尺寸变化另由 ResizeObserver 兼顾
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

  const count = items.length;
  const maxScroll = Math.max(0, metrics.scrollHeight - metrics.clientHeight);
  const scrollable = maxScroll > 1;
  const progress = maxScroll > 0 ? metrics.scrollTop / maxScroll : 0;

  const usableHeight = Math.max(0, metrics.clientHeight - RAIL_PADDING_PX * 2);
  const naturalGap =
    count > 1 ? (usableHeight - count * DASH_HEIGHT_PX) / (count - 1) : DASH_GAP_MAX_PX;
  // 画不下就不再一条条画，改成一整条滑动条
  const dense = count > 1 && naturalGap < DASH_GAP_MIN_PX;
  const dashGap = clamp(naturalGap, 0, DASH_GAP_MAX_PX);

  const visibleRatio = metrics.scrollHeight > 0 ? metrics.clientHeight / metrics.scrollHeight : 1;
  const thumbHeight = Math.max(THUMB_MIN_PX, usableHeight * clamp(visibleRatio, 0.05, 1));
  const thumbTop = Math.max(0, usableHeight - thumbHeight) * progress;

  /**
   * 量每条提问在内容里的位置。放在 effect 里而不是渲染期，渲染期读 ref 在并发渲染下不安全。
   * items 是整段会话（不随窗口变），所以还要盯 windowKey：窗口一滑就得重算。
   * 没渲染出来的那一条记 undefined，等着窗口滑过来。
   */
  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) {
      setAnchors([]);
      return;
    }

    const base = container.getBoundingClientRect().top - container.scrollTop;
    // 一次 querySelectorAll 建表，比每条 item 各查一次便宜（items 是整段会话）
    const rendered = new Map<string, HTMLElement>();
    content.querySelectorAll<HTMLElement>('[data-message-index]').forEach(element => {
      const key = element.dataset.messageIndex;
      if (key !== undefined) rendered.set(key, element);
    });

    const next = items.map(item => {
      const child = rendered.get(String(item.index));
      return child ? child.getBoundingClientRect().top - base : undefined;
    });
    setAnchors(next);

    // 之前点了一个还没渲染的提问，窗口已经滑过来了：滚到它
    const pending = pendingIndexRef.current;
    if (pending !== null) {
      const position = items.findIndex(item => item.index === pending);
      const anchor = position >= 0 ? next[position] : undefined;
      if (anchor !== undefined) {
        pendingIndexRef.current = null;
        container.scrollTop = anchor;
      }
    }
    // 依赖里**不能**放 metrics.clientHeight：锚点是相对内容的偏移，跟容器高度无关。
    // 而 composer 的开场形变 / 切会话过渡会每帧改容器高度，只要 clientHeight 在依赖里，
    // 这段就会每帧跑一次 querySelectorAll + 逐个 getBoundingClientRect（强制布局）——
    // 以前轨道只映射当前窗口的几条提问看不出，改成索引整段会话后就明显卡了。
  }, [containerRef, contentRef, items, windowKey, metrics.scrollHeight]);

  /** 指针落在轨道上的比例。两种形态的轨道都带同样的上下留白，所以共用一套换算 */
  const fractionFromClientY = (clientY: number) => {
    const rail = railRef.current;
    if (!rail) return 0;
    const rect = rail.getBoundingClientRect();
    const usable = Math.max(1, rect.height - RAIL_PADDING_PX * 2);
    return clamp((clientY - rect.top - RAIL_PADDING_PX) / usable, 0, 1);
  };

  const indexFromFraction = (fraction: number) =>
    count <= 1 ? 0 : Math.round(fraction * (count - 1));

  const scrollToIndex = (position: number) => {
    const container = containerRef.current;
    const item = items[position];
    if (!container || !item) return;

    const anchor = anchors[position];
    if (anchor !== undefined) {
      pendingIndexRef.current = null;
      container.scrollTop = anchor;
      return;
    }

    // 这条还没渲染：请上层把窗口滑到它，渲染完由锚点 effect 接手滚动
    pendingIndexRef.current = item.index;
    onNeedRender?.(item.index);
  };

  const track = (clientY: number) => {
    const rail = railRef.current;
    const fraction = fractionFromClientY(clientY);
    // 提示卡相对轨道所在的容器定位，所以纵向位置也要换算到同一坐标系
    const parentTop = rail?.parentElement?.getBoundingClientRect().top ?? 0;
    setHoveredIndex(indexFromFraction(fraction));
    setHoverY(clamp(clientY - parentTop, 0, metrics.clientHeight));
    return fraction;
  };

  const applyPointer = (clientY: number) => {
    const fraction = track(clientY);
    // 两种画法都按「跳到某次提问」处理：窗口是可滑动的，
    // 按比例滚当前窗口既跳不到没渲染的那条，也对不上整段会话的进度
    scrollToIndex(indexFromFraction(fraction));
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    applyPointer(event.clientY);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    track(event.clientY);
    if (!dragging) return;
    applyPointer(event.clientY);
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
      event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * container.clientHeight
          : event.deltaY;
    container.scrollTop += delta;
  };

  if (!scrollable || count === 0) return null;

  const isOpen = expanded || dragging;
  const preview = hoveredIndex === null ? null : items[hoveredIndex]?.text;
  const previewTop = clamp(hoverY, 48, Math.max(48, metrics.clientHeight - 48));
  const barWidth = isOpen ? 5 : 3;

  return (
    <>
      <div
        ref={railRef}
        role="scrollbar"
        aria-orientation="vertical"
        aria-controls={scrollId}
        aria-label="对话滚动条"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        tabIndex={0}
        style={{
          paddingTop: RAIL_PADDING_PX,
          paddingBottom: RAIL_PADDING_PX,
          ...(dense ? {} : { gap: dashGap }),
        }}
        className={`absolute right-0 z-20 flex w-4 cursor-pointer flex-col items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-border ${
          dense ? 'inset-y-0' : 'top-1/2 -translate-y-1/2'
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
        {dense ? (
          <div className="relative h-full w-full">
            <span
              data-part="track"
              aria-hidden="true"
              className="absolute left-1/2 top-0 h-full -translate-x-1/2 rounded-full bg-border transition-[width] duration-150"
              style={{ width: barWidth }}
            />
            <span
              data-part="thumb"
              aria-hidden="true"
              className="absolute left-1/2 -translate-x-1/2 rounded-full bg-muted transition-[width] duration-150"
              style={{ top: thumbTop, height: thumbHeight, width: barWidth }}
            />
          </div>
        ) : (
          <RailDashes items={items} hoveredIndex={hoveredIndex} isOpen={isOpen} />
        )}
      </div>

      {preview && (
        <div
          className="pointer-events-none absolute right-5 z-30 w-64 -translate-y-1/2 rounded-lg border border-border bg-background px-3 py-2 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.18)]"
          style={{ top: previewTop }}
        >
          <div className="text-[10.5px] text-muted">你</div>
          <p className="mt-0.5 line-clamp-3 text-[12px] leading-[1.65] text-foreground/90 break-words">
            {preview}
          </p>
        </div>
      )}
    </>
  );
}

/** 轨道不随「开侧栏 / 设置面板」这类无关 state 重渲染 */
export const ConversationScrollRail = memo(ConversationScrollRailBase);
