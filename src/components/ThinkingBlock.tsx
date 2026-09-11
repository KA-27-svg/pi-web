import { useState } from 'react';
import { ChevronRight, Sparkles } from 'lucide-react';

interface ThinkingBlockProps {
  reasoning: string;
  isStreaming?: boolean;
}

export function ThinkingBlock({ reasoning, isStreaming }: ThinkingBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!reasoning.trim()) return null;

  return (
    <div className="my-2 border border-border/80 rounded-lg bg-surface/50 text-xs overflow-hidden transition-all">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-3 py-2 text-muted hover:text-foreground transition-colors select-none text-left"
      >
        <Sparkles className="w-3.5 h-3.5 text-accent animate-pulse" />
        <span className="font-medium flex-1">
          {isStreaming ? '思考中...' : '已完成思考'}
        </span>
        <ChevronRight
          className={`w-3.5 h-3.5 transition-transform duration-200 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
      </button>

      {isOpen && (
        <div className="px-3 py-2.5 pt-1 border-t border-border/60 text-muted whitespace-pre-wrap font-mono text-[12px] leading-relaxed bg-surface/30 max-h-80 overflow-y-auto">
          {reasoning}
        </div>
      )}
    </div>
  );
}
