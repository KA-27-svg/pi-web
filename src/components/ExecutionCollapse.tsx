import { useState } from 'react';
import type { ToolCallState } from '../types/pi';
import { ToolCallCard } from './ToolCallCard';
import { reasoningParagraphs } from '../utils/format';
import { ChevronRight, Sparkles } from 'lucide-react';

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
  // 仅由用户点击决定开合，绝不随流式更新自动收起
  const [isOpen, setIsOpen] = useState(false);

  const hasReasoning = !!reasoning?.trim();
  const toolCount = tools?.length || 0;
  const hasTools = toolCount > 0;

  if (!hasReasoning && !hasTools) return null;

  const runningTool = tools?.find(t => t.status === 'running');

  const label = isStreaming
    ? runningTool
      ? `正在执行 ${runningTool.name}…`
      : '思考中…'
    : [hasReasoning && '思考', hasTools && `${toolCount} 步操作`]
        .filter(Boolean)
        .join(' · ');

  return (
    <div className="mb-3">
      {/* 一行灰字 —— 唯一的入口 */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="group flex items-center gap-1.5 text-[12px] text-muted hover:text-foreground transition-colors duration-150"
      >
        <ChevronRight
          className={`w-3 h-3 shrink-0 transition-transform duration-200 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
        <span>{label}</span>
      </button>

      {/* 展开：一根竖线 + 缩进，无底色无边框 */}
      {isOpen && (
        <div className="mt-3 ml-[5px] pl-4 border-l border-border space-y-4">
          {hasReasoning && (
            <div className="rounded-lg bg-surface/50 px-3.5 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-muted/70">
                <Sparkles className="w-3 h-3 shrink-0" />
                思考过程
              </div>

              <div className="space-y-2.5">
                {reasoningParagraphs(reasoning as string).map((paragraph, index) => (
                  <p
                    key={index}
                    className="text-[12px] leading-[1.85] text-muted whitespace-pre-wrap break-words"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          )}

          {hasTools && (
            <div className="space-y-2.5">
              {tools?.map(tool => (
                <ToolCallCard key={tool.id} tool={tool} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
