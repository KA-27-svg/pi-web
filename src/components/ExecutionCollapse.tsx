import { useContext, useEffect, useRef, useState } from 'react';
import type { ToolCallState } from '../types/pi';
import { ToolCallCard } from './ToolCallCard';
import { reasoningParagraphs } from '../utils/format';
import { isSidebarDismissClick } from '../utils/sidebarDismiss';
import { ExecutionDismissContext } from './executionDismissContext';
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
  /**
   * 开合跟着「流式阶段」走：只在用户点过的那个阶段里保持展开。
   * 思考期间点开看——回答一落地（streaming → done）就自动收起，把回答内容让出来；
   * 结束后再点开就一直开着（那时用户就是要看它）。不用 effect，渲染期直接派生。
   */
  const phase = isStreaming ? 'streaming' : 'done';
  const [openedPhase, setOpenedPhase] = useState<string | null>(null);
  const isOpen = openedPhase === phase;

  /** 外部交互是否正占着「点空白」（侧栏开着时为真） */
  const dismissSuspended = useContext(ExecutionDismissContext);
  const rootRef = useRef<HTMLDivElement>(null);

  // 展开后点对话区空白处就收起。只在对话区里、且是真正的空白（不是按钮/链接、
  // 也没在选字）才算；侧栏开着时这一下先留给它，下一次再收。
  useEffect(() => {
    if (!isOpen) return;

    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (rootRef.current?.contains(target as Node)) return;
      if (!(target instanceof Element) || !target.closest('#conversation-scroll')) return;
      if (dismissSuspended) return;
      if (!isSidebarDismissClick(target, window.getSelection()?.isCollapsed ?? true)) return;

      setOpenedPhase(null);
    };

    document.addEventListener('click', onDocumentClick);
    return () => document.removeEventListener('click', onDocumentClick);
  }, [isOpen, dismissSuspended]);

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
    <div ref={rootRef} className="mb-2">
      {/* 一行灰字 —— 唯一的入口 */}
      <button
        onClick={() => setOpenedPhase(prev => (prev === phase ? null : phase))}
        className="group flex items-center gap-1.5 text-[11.5px] text-muted hover:text-foreground transition-colors duration-150"
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
        <div className="mt-2 ml-[5px] pl-4 border-l border-border space-y-3">
          {hasReasoning && (
            <div className="rounded-lg bg-surface/50 px-3.5 py-3">
              <div className="mb-2 flex items-center gap-1.5 text-[10.5px] text-muted/70">
                <Sparkles className="w-3 h-3 shrink-0 text-amber-500" />
                思考过程
              </div>

              {/* 长思考别把整屏撑满：超过上限就内部滚动 */}
              <div data-reasoning className="max-h-64 space-y-2.5 overflow-y-auto">
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
            <div className="space-y-2">
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
