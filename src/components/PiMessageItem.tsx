import type { PiMessage } from '../types/pi';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownView } from './MarkdownView';
import { ToolCallCard } from './ToolCallCard';
import { User } from 'lucide-react';

interface PiMessageItemProps {
  message: PiMessage;
}

export function PiMessageItem({ message }: PiMessageItemProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`group flex gap-3.5 py-4 px-2 sm:px-4 rounded-xl transition-colors ${
        isUser ? 'bg-transparent' : 'bg-surface/50 hover:bg-surface/70'
      }`}
    >
      {/* 头像 */}
      <div className="flex-shrink-0 mt-0.5">
        {isUser ? (
          <div className="w-7 h-7 rounded-full bg-accent text-accent-foreground flex items-center justify-center shadow-xs">
            <User className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full bg-surface border border-border flex items-center justify-center text-foreground font-mono font-bold text-xs shadow-xs">
            π
          </div>
        )}
      </div>

      {/* 消息主体 */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">
            {isUser ? '你' : 'Pi Agent'}
          </span>
          <span className="text-[10px] text-muted">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {/* 思考过程折叠展示 */}
        {message.reasoning && (
          <ThinkingBlock
            reasoning={message.reasoning}
            isStreaming={message.status === 'streaming'}
          />
        )}

        {/* 工具调用卡片展示 (read, edit, write, bash 等) */}
        {message.tools && message.tools.length > 0 && (
          <div className="space-y-1.5 my-2">
            {message.tools.map(tool => (
              <ToolCallCard key={tool.id} tool={tool} />
            ))}
          </div>
        )}

        {/* 最终回复正文 */}
        {message.content ? (
          <MarkdownView content={message.content} />
        ) : (
          message.status === 'streaming' &&
          !message.reasoning &&
          (!message.tools || message.tools.length === 0) && (
            <div className="flex items-center gap-1.5 py-1 text-muted text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
              <span>Pi 正在理解并规划任务...</span>
            </div>
          )
        )}
      </div>
    </div>
  );
}
