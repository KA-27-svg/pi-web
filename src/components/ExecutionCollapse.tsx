import { useState } from 'react';
import type { ToolCallState } from '../types/pi';
import { ToolCallCard } from './ToolCallCard';
import { ChevronRight, Sparkles, Wrench } from 'lucide-react';

interface ExecutionCollapseProps {
  reasoning?: string;
  tools?: ToolCallState[];
  isStreaming?: boolean;
}

export function ExecutionCollapse({
  reasoning,
  tools,
  isStreaming,
}: ExecutionCollapseProps) {
  // 生成中如果正在思考或运行工具，默认展开以便实时观测；完成后统一收起
  const [isOpen, setIsOpen] = useState(false);

  const hasReasoning = !!reasoning?.trim();
  const hasTools = !!(tools && tools.length > 0);

  if (!hasReasoning && !hasTools) return null;

  const toolCount = tools?.length || 0;
  const runningTool = tools?.find(t => t.status === 'running');

  return (
    <div className="my-2 rounded-xl border border-border/70 bg-surface/60 overflow-hidden text-xs transition-all">
      {/* 统一顶层折叠条 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3.5 py-2 text-muted hover:text-foreground hover:bg-surface-hover/50 transition-colors select-none text-left"
      >
        <div className="flex items-center gap-2">
          {isStreaming ? (
            <span className="w-2 h-2 rounded-full bg-accent animate-ping" />
          ) : (
            <Sparkles className="w-3.5 h-3.5 text-accent/80" />
          )}

          <span className="font-medium text-[12px] text-foreground/90">
            {isStreaming
              ? runningTool
                ? `正在执行: ${runningTool.name}...`
                : 'Pi 正在思考与调用工具...'
              : '思考过程与执行记录'}
          </span>

          <div className="flex items-center gap-1.5 ml-1">
            {hasReasoning && (
              <span className="px-1.5 py-0.5 rounded bg-background border border-border/60 text-[10px] font-mono text-muted">
                思考
              </span>
            )}
            {hasTools && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-background border border-border/60 text-[10px] font-mono text-muted">
                <Wrench className="w-2.5 h-2.5" />
                {toolCount} 个操作
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 text-[11px] text-muted">
          <span>{isOpen ? '收起' : '展开详情'}</span>
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        </div>
      </button>

      {/* 展开后显现具体内容 */}
      {isOpen && (
        <div className="px-3.5 py-3 border-t border-border/60 space-y-2.5 bg-background/40">
          {/* 思考链详情 */}
          {hasReasoning && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-accent" />
                思考分析 (Thinking)
              </div>
              <div className="p-3 rounded-lg border border-border/60 bg-surface/40 text-muted whitespace-pre-wrap font-mono text-[11px] leading-relaxed max-h-72 overflow-y-auto">
                {reasoning}
              </div>
            </div>
          )}

          {/* 工具调用卡片列表 */}
          {hasTools && (
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1.5 flex items-center gap-1">
                <Wrench className="w-3 h-3 text-accent" />
                已执行工具 ({toolCount})
              </div>
              <div className="space-y-1.5">
                {tools?.map(tool => (
                  <ToolCallCard key={tool.id} tool={tool} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
