import { useState, useRef, useEffect } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isLoading: boolean;
}

export function ChatInput({ onSend, onStop, isLoading }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(
        textareaRef.current.scrollHeight,
        200
      )}px`;
    }
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  return (
    <div className="w-full max-w-3xl mx-auto px-4 pb-4 sm:pb-6">
      <div className="relative flex items-end bg-surface border border-border focus-within:border-accent/40 rounded-2xl shadow-sm transition-all duration-200">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="给 Pi 发送消息... (Enter 发送，Shift+Enter 换行)"
          rows={1}
          className="w-full resize-none bg-transparent py-3 pl-4 pr-12 text-[14px] text-foreground placeholder:text-muted focus:outline-none max-h-48 leading-relaxed"
        />

        <div className="absolute right-2 bottom-2">
          {isLoading ? (
            <button
              onClick={onStop}
              className="p-2 rounded-xl bg-accent text-accent-foreground hover:bg-accent-hover transition-colors"
              title="停止生成"
            >
              <Square className="w-4 h-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2 rounded-xl bg-accent text-accent-foreground hover:bg-accent-hover disabled:opacity-30 disabled:hover:bg-accent transition-all duration-150"
              title="发送"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>
      <p className="text-center text-[11px] text-muted/70 mt-2">
        Pi 可能会产生不准确的信息，请自行核对重要内容。
      </p>
    </div>
  );
}
