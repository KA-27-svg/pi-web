import type { PiMessage } from '../types/pi';
import { MarkdownView } from './MarkdownView';
import { ExecutionCollapse } from './ExecutionCollapse';

interface PiMessageItemProps {
  message: PiMessage;
}

export function PiMessageItem({ message }: PiMessageItemProps) {
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';

  // 用户：右对齐，仅一层极淡底，无边框无阴影
  if (isUser) {
    return (
      <div className="paper-in flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface px-4 py-2.5 text-[14.5px] leading-[1.7] whitespace-pre-wrap break-words">
          {message.content}
        </div>
      </div>
    );
  }

  // Pi：左对齐，完全无容器，纯正文流
  return (
    <div className="paper-in">
      <ExecutionCollapse
        key={message.id}
        reasoning={message.reasoning}
        tools={message.tools}
        isStreaming={isStreaming}
      />

      {message.content && <MarkdownView content={message.content} />}

      {message.error && (
        <p className="mt-2 text-[12.5px] leading-[1.7] text-rose-500 break-words">
          {message.error}
        </p>
      )}
    </div>
  );
}
