import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import './ChatInput.css';

/** 单行时外壳的高度 */
const COMPOSER_MIN_HEIGHT = 53;
/** 长高的上限，与 textarea 的 max-h-48 保持一致 */
const COMPOSER_MAX_HEIGHT = 192;
/** 开场形变时长，覆盖 CSS 里最长的过渡 */
const MORPH_MS = 760;

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isLoading: boolean;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
  /** 开场图标态：与展开后的输入框是同一个元素，点击后原地形变 */
  showIcon?: boolean;
  onActivate?: () => void;
  /** 外壳高度变化（多行输入）时通知父级，便于贴底时重新对齐滚动位置 */
  onResize?: () => void;
}

export function ChatInput({
  onSend,
  onStop,
  isLoading,
  onFocusChange,
  autoFocus,
  showIcon = false,
  onActivate,
  onResize,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // 只在开场形变期间让外壳高度参与过渡；平时打字必须立刻跟上文字。
  // 用 CSS 变量而不是 class，避免 React 重写 className 时把标记冲掉。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    if (showIcon) {
      stage.style.setProperty('--composer-morph-ms', `${MORPH_MS}ms`);
      return;
    }
    const timer = window.setTimeout(
      () => stage.style.setProperty('--composer-morph-ms', '0ms'),
      MORPH_MS
    );
    return () => window.clearTimeout(timer);
  }, [showIcon]);

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // 展开后自动聚焦：点开图标即可直接输入，不必再点一次。
  // 注意这里不触发展开下移——下移只由用户主动点击输入框触发。
  useEffect(() => {
    if (showIcon) return;
    textareaRef.current?.focus();
  }, [showIcon]);

  const measure = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const height = Math.min(
      Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT),
      COMPOSER_MAX_HEIGHT
    );
    el.style.height = `${height}px`;
    // 外壳（.pi-stage 与 .pi-composer）跟着一起长高，否则文字会溢出圆角背景
    stageRef.current?.style.setProperty('--composer-height', `${height}px`);
    onResize?.();
  }, [onResize]);

  useEffect(() => {
    measure();
  }, [input, measure]);

  // 宽度变化时重新自适应：开场图标态外壳很窄，会让占位文字折行得到错误高度
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      measure();
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [measure]);

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

  const activate = () => {
    if (showIcon) onActivate?.();
  };

  const canSend = !!input.trim();

  return (
    <div className="w-full max-w-2xl mx-auto px-5 sm:px-6 pb-6 sm:pb-8">
      <div className="pi-stage" ref={stageRef}>
        <div
          className={`pi-composer relative flex items-end rounded-2xl bg-surface ${
            showIcon ? 'is-icon' : ''
          }`}
          role={showIcon ? 'button' : undefined}
          tabIndex={showIcon ? 0 : undefined}
          aria-label={showIcon ? '打开 Pi Agent 对话' : undefined}
          onClick={showIcon ? activate : undefined}
          onKeyDown={
            showIcon
              ? e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activate();
                  }
                }
              : undefined
          }
        >
          <svg className="pi-glyph" viewBox="0 0 96 96" aria-hidden="true">
            <path className="pi-stroke pi-stroke--stem" d="M27 70V27" />
            <path
              className="pi-stroke pi-stroke--bowl"
              d="M27 28H47C60 28 60 48 47 48H27"
            />
            <path className="pi-stroke pi-stroke--i" d="M68 45V70" />
            <circle className="pi-stroke pi-stroke--dot" cx="68" cy="30" r="3" />
          </svg>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onPointerDown={() => onFocusChange?.(true)}
            placeholder="给 Pi 发送消息…"
            rows={1}
            tabIndex={showIcon ? -1 : undefined}
            className="w-full resize-none bg-transparent py-3.5 pl-4 pr-12 text-[14.5px] leading-[1.7] text-foreground placeholder:text-[color:var(--placeholder)] focus:outline-none max-h-48"
          />

          <div className="pi-controls absolute right-2 bottom-2">
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
    </div>
  );
}
