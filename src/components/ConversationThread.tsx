import type { RefObject } from 'react';
import type { PiMessage } from '../types/pi';
import { PiMessageItem } from './PiMessageItem';

interface ConversationThreadProps {
  messages: PiMessage[];
  /**
   * 切换会话中：不显示任何内容（也不显示上一个会话）。
   * 用 visibility 隐藏而不是不渲染，是为了让布局高度保持不变——
   * 一旦塌陷，底部输入区位置和滚动位置都会跟着弹一次。
   */
  switching?: boolean;
  contentRef: RefObject<HTMLDivElement | null>;
  endRef: RefObject<HTMLDivElement | null>;
}

export function ConversationThread({
  messages,
  switching = false,
  contentRef,
  endRef,
}: ConversationThreadProps) {
  if (messages.length === 0) return null;

  return (
    <div
      ref={contentRef}
      className={`max-w-content mx-auto px-5 sm:px-6 py-10 space-y-8 ${
        switching ? 'invisible' : ''
      }`}
    >
      {messages.map(message => (
        <PiMessageItem key={message.id} message={message} />
      ))}
      <div ref={endRef} className="h-1" />
    </div>
  );
}
