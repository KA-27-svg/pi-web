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
  /** 上一次真正应用到外壳的高度，用来跳过无变化的写入 */
  const appliedHeightRef = useRef(0);

  // 标记形变窗口。用属性而不是自定义属性：transition 里引用变量会被任何变量变动打断。
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
    const stage = stageRef.current;
    if (!el || !stage) return;

    let height: number;
    if (stage.hasAttribute('data-morphing')) {
      /*
       * 图标态与形变期间外壳只有 112px 宽，减去左右内边距后文字区不到 50px，
       * 占位文字会被折成好几行，scrollHeight 直接顶到上限；而这段时间输入必定为空，
       * 正确高度就是单行高度。顺便也省掉一次强制布局（形变时 width 每帧都在变）。
       */
      height = COMPOSER_MIN_HEIGHT;
    } else {
      // 必须先把高度复位到 auto，否则 scrollHeight 会被当前高度撑住，收回时量不准
      el.style.height = 'auto';
      height = Math.min(
        Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT),
        COMPOSER_MAX_HEIGHT
      );
    }
    // 总是写回，避免上面探针留在 auto 上把文字区收空
    el.style.height = `${height}px`;

    // 外壳高度会连带压缩整个对话区，所以只在真的变化时才写，
    // 否则开场形变期间每帧一次会让动画直接卡住
    if (height === appliedHeightRef.current) return;
    appliedHeightRef.current = height;

    stage.style.setProperty('--composer-height', `${height}px`);
    onResize?.();
  }, [onResize]);

  /**
   * 形变窗口：图标态一直处于窗口内；展开后再持续一小段。
   * 必须在 measure 之后声明，因为窗口结束时要用它补测一次。
   */
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    if (showIcon) {
      stage.setAttribute('data-morphing', 'true');
      return;
    }
    const timer = window.setTimeout(() => {
      stage.removeAttribute('data-morphing');
      // 形变期间不测量，结束后补一次，覆盖期间可能已经输入的内容
      measure();
    }, MORPH_MS);
    return () => window.clearTimeout(timer);
  }, [showIcon, measure]);

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
