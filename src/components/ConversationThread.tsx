import { useEffect, useRef, type RefObject } from 'react';
import type { PiMessage } from '../types/pi';
import { PiMessageItem } from './PiMessageItem';

interface ConversationThreadProps {
  /** 当前窗口内要渲染的这一段消息，不是整段历史 */
  messages: PiMessage[];
  /**
   * 切换会话中：不显示任何内容（也不显示上一个会话）。
   * 用 visibility 隐藏而不是不渲染，是为了让布局高度保持不变——
   * 一旦塌陷，底部输入区位置和滚动位置都会跟着弹一次。
   */
  switching?: boolean;
  /** 更早的消息还存在，只是没渲染 */
  hasEarlier?: boolean;
  onLoadEarlier?: () => void;
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

export function ConversationThread({
  messages,
  switching = false,
  hasEarlier = false,
  onLoadEarlier,
  onOpenFile,
  fallbackModel,
  modelNames,
  scrollRef,
  contentRef,
  endRef,
}: ConversationThreadProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  /**
   * 滚到顶就把更早的一页放进来（官方 pi-web 用的也是 sentinel + IntersectionObserver）。
   * 补进来的那页把视线推下去之后 sentinel 就离开视口，所以要配合调用方的滚动位置补偿，
   * 否则它会一直可见、把整段历史连续拉完。
   */
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!hasEarlier || !sentinel || !root) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0]?.isIntersecting) onLoadEarlier?.();
      },
      { root }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasEarlier, onLoadEarlier, scrollRef]);

  if (messages.length === 0) return null;

  return (
    <div
      ref={contentRef}
      className={`max-w-content mx-auto px-5 sm:px-6 py-10 space-y-8 ${
        switching ? 'invisible' : ''
      }`}
    >
      {hasEarlier && (
        <div ref={sentinelRef} className="py-3 text-center text-[11.5px] text-muted">
          向上滚动加载更早的消息
        </div>
      )}

      {messages.map((message, index) => (
        <PiMessageItem
          key={message.id}
          dataIndex={index}
          message={message}
          onOpenFile={onOpenFile}
          fallbackModel={fallbackModel}
          modelNames={modelNames}
        />
      ))}
      <div ref={endRef} className="h-1" />
    </div>
  );
}
