import { memo, useEffect, useRef, type RefObject } from 'react';
import type { PiMessage } from '../types/pi';
import { PiMessageItem } from './PiMessageItem';

interface ConversationThreadProps {
  /** 当前窗口内要渲染的这一段消息，不是整段历史 */
  messages: PiMessage[];
  /**
   * 这一段的第一条在整段消息里的下标。
   * 消息上的 data-message-index 用它换算成绝对下标，右侧轨道才找得到。
   */
  startIndex?: number;
  /**
   * 切换会话中：不显示任何内容（也不显示上一个会话）。
   * 用 visibility 隐藏而不是不渲染，是为了让布局高度保持不变——
   * 一旦塌陷，底部输入区位置和滚动位置都会跟着弹一次。
   */
  switching?: boolean;
  /** 更早的消息还存在，只是没渲染 */
  hasEarlier?: boolean;
  onLoadEarlier?: () => void;
  /** 更后的消息还存在（跳到了中间某处），只是没渲染 */
  hasLater?: boolean;
  onLoadLater?: () => void;
  /** 点开文件附件时交回上层（用系统默认程序打开） */
  onOpenFile?: (path: string) => void;
  /** 当前会话模型名，透传给每条回答做兜底 */
  fallbackModel?: string;
  /** 模型 id → 显示名，透传 */
  modelNames?: Record<string, string>;
  scrollRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
}

function ConversationThreadBase({
  messages,
  startIndex = 0,
  switching = false,
  hasEarlier = false,
  onLoadEarlier,
  hasLater = false,
  onLoadLater,
  onOpenFile,
  fallbackModel,
  modelNames,
  scrollRef,
  contentRef,
  endRef,
}: ConversationThreadProps) {
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const bottomSentinelRef = useRef<HTMLDivElement>(null);

  /**
   * 滚到顶 / 底就把相邻的一页放进来。补进来的那页会把哨兵推出视口，所以不会
   * 一直可见、把整段历史连续拉完。
   */
  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;

    const observers: IntersectionObserver[] = [];
    const watch = (element: HTMLElement | null, onHit?: () => void) => {
      if (!element || !onHit) return;
      const observer = new IntersectionObserver(
        entries => {
          if (entries[0]?.isIntersecting) onHit();
        },
        { root }
      );
      observer.observe(element);
      observers.push(observer);
    };

    if (hasEarlier) watch(topSentinelRef.current, onLoadEarlier);
    if (hasLater) watch(bottomSentinelRef.current, onLoadLater);

    return () => observers.forEach(observer => observer.disconnect());
  }, [hasEarlier, hasLater, onLoadEarlier, onLoadLater, scrollRef]);

  if (messages.length === 0) return null;

  return (
    <div
      ref={contentRef}
      className={`max-w-content mx-auto px-5 sm:px-6 py-10 space-y-8 ${
        switching ? 'invisible' : ''
      }`}
    >
      {hasEarlier && (
        <div ref={topSentinelRef} className="py-3 text-center text-[11.5px] text-muted">
          向上滚动加载更早的消息
        </div>
      )}

      {messages.map((message, index) => (
        <PiMessageItem
          key={message.id}
          dataIndex={startIndex + index}
          message={message}
          onOpenFile={onOpenFile}
          fallbackModel={fallbackModel}
          modelNames={modelNames}
        />
      ))}

      {hasLater && (
        <div ref={bottomSentinelRef} className="py-3 text-center text-[11.5px] text-muted">
          向下滚动加载更新的消息
        </div>
      )}
      <div ref={endRef} className="h-1" />
    </div>
  );
}

/** 消息列不随「开侧栏 / 设置面板」这类无关 state 重渲染 */
export const ConversationThread = memo(ConversationThreadBase);
