import { useState } from 'react';
import type { ToolCallState } from '../types/pi';
import { Terminal, FileText, Edit3, PenTool, CheckCircle2, Loader2, ChevronRight } from 'lucide-react';

interface ToolCallCardProps {
  tool: ToolCallState;
}

export function ToolCallCard({ tool }: ToolCallCardProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 根据不同工具匹配图标与说明
  const getToolMeta = () => {
    switch (tool.name) {
      case 'read':
        return {
          icon: <FileText className="w-3.5 h-3.5 text-blue-400" />,
          title: `读取文件: ${tool.args?.path || ''}`,
          badge: 'READ',
        };
      case 'edit':
        return {
          icon: <Edit3 className="w-3.5 h-3.5 text-amber-400" />,
          title: `编辑文件: ${tool.args?.path || ''}`,
          badge: 'EDIT',
        };
      case 'write':
        return {
          icon: <PenTool className="w-3.5 h-3.5 text-emerald-400" />,
          title: `写入文件: ${tool.args?.path || ''}`,
          badge: 'WRITE',
        };
      case 'bash':
        return {
          icon: <Terminal className="w-3.5 h-3.5 text-purple-400" />,
          title: `执行命令: ${tool.args?.command || ''}`,
          badge: 'BASH',
        };
      default:
        return {
          icon: <Terminal className="w-3.5 h-3.5 text-accent" />,
          title: `调用工具: ${tool.name}`,
          badge: tool.name.toUpperCase(),
        };
    }
  };

  const meta = getToolMeta();

  return (
    <div className="my-2 border border-border/70 rounded-lg bg-surface/80 overflow-hidden text-xs transition-all shadow-2xs">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-surface-hover/60 transition-colors select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          {tool.status === 'running' ? (
            <Loader2 className="w-3.5 h-3.5 text-accent animate-spin flex-shrink-0" />
          ) : (
            meta.icon
          )}
          <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-background/80 border border-border/60 text-muted font-medium">
            {meta.badge}
          </span>
          <span className="font-medium text-foreground truncate max-w-sm sm:max-w-md">
            {meta.title}
          </span>
        </div>

        <div className="flex items-center gap-1.5 text-muted">
          {tool.status === 'done' && (
            <span className="text-[10px] text-emerald-500 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              已完成
            </span>
          )}
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform duration-200 ${
              isOpen ? 'rotate-90' : ''
            }`}
          />
        </div>
      </div>

      {/* 展开查看参数和详细执行结果 */}
      {isOpen && (
        <div className="px-3 py-2 border-t border-border/50 bg-[#121318] text-gray-200 font-mono text-[11px] max-h-60 overflow-y-auto leading-relaxed">
          {tool.args && (
            <div className="mb-2">
              <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">
                参数 (Arguments):
              </div>
              <pre className="text-gray-300 whitespace-pre-wrap break-all">
                {JSON.stringify(tool.args, null, 2)}
              </pre>
            </div>
          )}

          {tool.result && (
            <div>
              <div className="text-gray-400 text-[10px] uppercase tracking-wider mb-1">
                输出结果 (Output):
              </div>
              <pre className="text-emerald-400/90 whitespace-pre-wrap break-all">
                {typeof tool.result === 'string'
                  ? tool.result
                  : JSON.stringify(tool.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
