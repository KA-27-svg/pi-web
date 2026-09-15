import { useState } from 'react';
import type { ToolCallState } from '../types/pi';
import { toolKind, type ToolKind } from '../utils/toolKind';
import { ChevronRight, Loader2 } from 'lucide-react';

interface ToolCallCardProps {
  tool: ToolCallState;
}

/**
 * 每种工具一个标签配色。同文件图标一样：颜色只用来「一眼分辨」，
 * 用 500 档 + 10% 底，深浅两种主题下都读得清。
 */
const TONES: Record<ToolKind, string> = {
  shell: 'bg-amber-500/10 text-amber-600',
  read: 'bg-sky-500/10 text-sky-600',
  write: 'bg-emerald-500/10 text-emerald-600',
  edit: 'bg-violet-500/10 text-violet-600',
  search: 'bg-teal-500/10 text-teal-600',
  other: 'bg-surface text-muted',
};

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
        text: a.path || a.command || a.pattern || JSON.stringify(a).slice(0, 120),
      };
  }
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { tag, text } = summarize(tool);
  const kind = toolKind(tool.name);
  const edits: any[] = Array.isArray(tool.args?.edits) ? tool.args.edits : [];

  // shell 的 args 只有一个 command，而命令已经在上面的摘要里了：
  // 展开时把它当「完整命令」显示，而不是再糊一段 JSON
  const shellCommand = kind === 'shell' && typeof tool.args?.command === 'string'
    ? (tool.args.command as string)
    : null;

  return (
    <div className="text-[12px]">
      {/* 一行：标签 摘要 */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        aria-expanded={isOpen}
        className="group -mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface/60"
      >
        <span
          className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide ${TONES[kind]}`}
        >
          {tag}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80 transition-colors group-hover:text-foreground">
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
        <div className="mt-2 ml-[6px] space-y-3 border-l border-border pl-4">
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

          {/* shell：完整命令单独一行，用等宽字，不加框 */}
          {shellCommand && (
            <div className="font-mono text-[11.5px] leading-[1.75] text-foreground/80 whitespace-pre-wrap break-all">
              {shellCommand}
            </div>
          )}

          {/* 其它工具：参数照旧 */}
          {edits.length === 0 && !shellCommand && tool.args && (
            <pre className="font-mono text-[11.5px] leading-[1.75] text-muted whitespace-pre-wrap break-all">
              {JSON.stringify(tool.args, null, 2)}
            </pre>
          )}

          {/* 输出 */}
          {tool.result && (
            <pre className="max-h-72 overflow-y-auto rounded-lg border border-[var(--code-border)] bg-[var(--code-bg)] px-3.5 py-3 font-mono text-[11.5px] leading-[1.75] text-foreground/80 whitespace-pre-wrap break-all">
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
