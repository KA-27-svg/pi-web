import { useState } from 'react';
import type { ToolCallState } from '../types/pi';
import { ChevronRight, Loader2 } from 'lucide-react';

interface ToolCallCardProps {
  tool: ToolCallState;
}

/** 不同工具 → 一行摘要 */
function summarize(tool: ToolCallState) {
  const a = tool.args || {};
  switch (tool.name) {
    case 'read':
    case 'edit':
    case 'write':
      return { tag: tool.name, text: a.path || '' };
    case 'bash':
      return { tag: 'bash', text: a.command || '' };
    default:
      return {
        tag: tool.name,
        text:
          a.path || a.command || a.pattern || JSON.stringify(a).slice(0, 120),
      };
  }
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { tag, text } = summarize(tool);
  const edits: any[] = Array.isArray(tool.args?.edits) ? tool.args.edits : [];

  return (
    <div className="text-[12px]">
      {/* 一行：TAG  摘要 */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className="group flex w-full items-baseline gap-3 text-left"
      >
        <span className="w-11 shrink-0 font-mono text-[11px] uppercase tracking-wide text-muted/70">
          {tag}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-foreground/75 group-hover:text-foreground transition-colors">
          {text}
        </span>
        {tool.status === 'running' ? (
          <Loader2 className="w-3 h-3 shrink-0 animate-spin text-muted" />
        ) : (
          <ChevronRight
            className={`w-3 h-3 shrink-0 text-muted/50 transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        )}
      </button>

      {/* 展开：缩进 + 竖线，与上层同一套语言 */}
      {isOpen && (
        <div className="mt-2 ml-[3.25rem] pl-4 border-l border-border space-y-3">
          {/* edit 专属：增删对照 */}
          {edits.length > 0 && (
            <div className="space-y-2">
              {edits.map((item, idx) => (
                <div key={idx} className="font-mono text-[11.5px] leading-[1.7]">
                  {item.oldText && (
                    <div className="whitespace-pre-wrap break-all text-rose-500/80">
                      {String(item.oldText)
                        .split('\n')
                        .map((l: string, i: number) => (
                          <div key={i}>- {l}</div>
                        ))}
                    </div>
                  )}
                  {item.newText && (
                    <div className="whitespace-pre-wrap break-all text-emerald-600/80 dark:text-emerald-400/80">
                      {String(item.newText)
                        .split('\n')
                        .map((l: string, i: number) => (
                          <div key={i}>+ {l}</div>
                        ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 非 edit：参数 */}
          {edits.length === 0 && tool.args && (
            <pre className="font-mono text-[11.5px] leading-[1.7] text-muted whitespace-pre-wrap break-all">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          )}

          {/* 输出 */}
          {tool.result && (
            <pre className="rounded-md bg-[var(--code-bg)] border border-[var(--code-border)] px-3 py-2.5 font-mono text-[11.5px] leading-[1.7] text-foreground/80 whitespace-pre-wrap break-all max-h-72 overflow-y-auto">
              {typeof tool.result === 'string'
                ? tool.result
                : JSON.stringify(tool.result, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
