import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { DEFAULT_RATIO, ratioFromPointer } from '../utils/paneRatio';

/** 窄屏下不再并排（并排各剩一半太窄了），改成 tab 切换 */
const NARROW_QUERY = '(max-width: 900px)';

/** jsdom 没有 matchMedia，别让它在测试环境里炸掉 */
function mediaMatches(query: string): boolean {
  return typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false;
}

interface AssistantLayoutProps {
  /** 助手模式开关 */
  enabled: boolean;
  /** 顾问那一栏的宽度占比 */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  /** 执行窗口（左） */
  main: ReactNode;
  /** 顾问窗口（右）。enabled 为真时才需要传 */
  advisor?: ReactNode;
}

/**
 * 助手模式的分栏。
 *
 * **执行窗口在左、顾问在右**：开关一开一关时执行窗口和侧栏都不会挪位置，
 * 新出现的顾问栏落在右边的空位里。反过来的话，每切一次模式整个界面都要重排一次，
 * 而这种「随手切一下」的开关不该有这种代价。
 */
export function AssistantLayout({
  enabled,
  ratio,
  onRatioChange,
  main,
  advisor,
}: AssistantLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [narrow, setNarrow] = useState(() => mediaMatches(NARROW_QUERY));
  const [tab, setTab] = useState<'main' | 'advisor'>('main');

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    // 抓住指针：拖到 pane 外面也继续收 move，不会拖丢
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    onRatioChange(ratioFromPointer(event.clientX, rect));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  if (!enabled) {
    return <div className="flex min-h-0 min-w-0 flex-1">{main}</div>;
  }

  if (narrow) {
    const tabs: Array<{ id: 'main' | 'advisor'; label: string }> = [
      { id: 'main', label: '执行' },
      { id: 'advisor', label: '顾问' },
    ];

    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* mt-12 是给右上角那排悬浮按钮让位（它们在 top-3） */}
        <div className="mt-12 flex shrink-0 items-center justify-center gap-1">
          {tabs.map(item => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              aria-pressed={tab === item.id}
              className={`rounded-full px-3 py-1 text-[12px] transition-colors ${
                tab === item.id
                  ? 'bg-foreground text-background'
                  : 'text-muted hover:bg-surface hover:text-foreground'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">{tab === 'advisor' ? advisor : main}</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-h-0 min-w-0 flex-1">
      <div
        className="flex min-h-0 min-w-0 flex-col"
        style={{ flexGrow: 1 - ratio, flexBasis: 0 }}
      >
        {main}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="调整顾问窗口宽度"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => onRatioChange(DEFAULT_RATIO)}
        title="拖动调整宽度（双击复位）"
        className="relative w-px shrink-0 cursor-col-resize bg-border"
      >
        {/* 1px 的线太难点，把可点区域左右各撑开一点（线本身不变粗） */}
        <span className="absolute inset-y-0 -left-1 -right-1" />
      </div>

      <div className="flex min-h-0 min-w-0 flex-col" style={{ flexGrow: ratio, flexBasis: 0 }}>
        {advisor}
      </div>
    </div>
  );
}
