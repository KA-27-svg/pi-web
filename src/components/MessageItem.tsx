import type { Message } from '../types';
import { ThinkingBlock } from './ThinkingBlock';
import { MarkdownView } from './MarkdownView';
import { Bot, User, AlertCircle } from 'lucide-react';

interface MessageItemProps {
  message: Message;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={`group flex gap-3.5 py-4 px-2 sm:px-4 rounded-xl transition-colors ${
        isUser ? 'bg-transparent' : 'bg-surface/40 hover:bg-surface/70'
      }`}
    >
      {/* 头像 */}
      <div className="flex-shrink-0 mt-0.5">
        {isUser ? (
          <div className="w-7 h-7 rounded-full bg-accent text-accent-foreground flex items-center justify-center shadow-xs">
            <User className="w-4 h-4" />
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full bg-surface border border-border flex items-center justify-center text-foreground shadow-xs">
            <Bot className="w-4 h-4 text-accent" />
          </div>
        )}
      </div>

      {/* 消息主体 */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">
            {isUser ? '你' : 'Pi'}
          </span>
          <span className="text-[10px] text-muted">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {/* 思考链展示（渐进式折叠） */}
        {message.reasoning && (
          <ThinkingBlock
            reasoning={message.reasoning}
            isStreaming={message.status === 'streaming'}
          />
        )}

        {/* 正文渲染 */}
        {message.content ? (
          <MarkdownView content={message.content} />
        ) : (
          message.status === 'streaming' &&
          !message.reasoning && (
            <div className="flex items-center gap-1.5 py-1 text-muted text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
              <span>正在构思回复...</span>
            </div>
          )
        )}

        {/* 错误提示 */}
        {message.status === 'error' && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-rose-500 bg-rose-500/10 px-3 py-2 rounded-md border border-rose-500/20">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{message.error || '生成失败，请检查网络或 API 配置'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
