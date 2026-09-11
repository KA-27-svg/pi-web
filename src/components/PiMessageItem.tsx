import type { PiMessage } from '../types/pi';
import { MarkdownView } from './MarkdownView';
import { ExecutionCollapse } from './ExecutionCollapse';
import { User } from 'lucide-react';

interface PiMessageItemProps {
  message: PiMessage;
}

export function PiMessageItem({ message }: PiMessageItemProps) {
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';

  if (isUser) {
    // 用户消息：靠右对齐气泡风格
    return (
      <div className="flex justify-end gap-2.5 py-2.5 px-2 sm:px-4">
        <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%]">
          <div className="flex items-center gap-1.5 mb-1 select-none">
            <span className="text-[10px] text-muted">
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="text-xs font-medium text-foreground">你</span>
          </div>

          <div className="rounded-2xl rounded-tr-xs bg-accent text-accent-foreground px-4 py-2.5 shadow-xs text-[14px] leading-relaxed break-words whitespace-pre-wrap">
            {message.content}
          </div>
        </div>

        {/* 用户头像 */}
        <div className="w-7 h-7 rounded-full bg-accent text-accent-foreground flex items-center justify-center flex-shrink-0 mt-1 shadow-xs select-none">
          <User className="w-4 h-4" />
        </div>
      </div>
    );
  }

  // 模型 (Pi Agent) 消息：靠左对齐，沉浸式宽幅排版
  return (
    <div className="flex justify-start gap-3 py-3 px-2 sm:px-4 group">
      {/* Pi 专属图标头像 */}
      <div className="w-7 h-7 rounded-full bg-surface border border-border flex items-center justify-center text-foreground font-mono font-bold text-xs shadow-xs flex-shrink-0 mt-1 select-none">
        π
      </div>

      <div className="flex-1 min-w-0 max-w-[92%] sm:max-w-[85%] space-y-2">
        <div className="flex items-center gap-2 select-none">
          <span className="text-xs font-semibold text-foreground">Pi Agent</span>
          <span className="text-[10px] text-muted">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {/* 思考过程 + 已执行工具：统一收归为一个优雅的渐进式折叠组件 */}
        <ExecutionCollapse
          reasoning={message.reasoning}
          tools={message.tools}
          isStreaming={isStreaming}
        />

        {/* 最终回复正文 */}
        {message.content ? (
          <div className="p-3.5 rounded-2xl rounded-tl-xs bg-surface/40 border border-border/40">
            <MarkdownView content={message.content} />
          </div>
        ) : (
          isStreaming &&
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
