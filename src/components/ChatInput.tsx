import { useState, useRef, useEffect } from 'react';
import { ArrowUp, Square } from 'lucide-react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isLoading: boolean;
  autoFocus?: boolean;
}

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  autoFocus,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法选词时的 Enter 不触发发送
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const canSend = !!input.trim();

  return (
    <div className="w-full max-w-2xl mx-auto px-5 sm:px-6 pb-6 sm:pb-8">
      {/* 无边框、无阴影：始终保持输入时的状态 */}
      <div className="relative flex items-end rounded-2xl bg-surface transition-colors duration-200">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="给 Pi 发送消息…"
          rows={1}
          className="w-full resize-none bg-transparent py-3.5 pl-4 pr-12 text-[14.5px] leading-[1.7] text-foreground placeholder:text-muted/70 focus:outline-none max-h-48"
        />

        <div className="absolute right-2 bottom-2">
          {isLoading ? (
            <button
              onClick={onStop}
              className="p-2 rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
              title="停止生成"
              aria-label="停止生成"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!canSend}
              className={`p-2 rounded-full transition-all duration-150 ${
                canSend
                  ? 'bg-foreground text-background hover:opacity-80'
                  : 'text-muted/40 cursor-default'
              }`}
              title="发送"
              aria-label="发送"
            >
              <ArrowUp className="w-4 h-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
