import { useEffect, useRef, useState } from 'react';
import './OpeningTransition.css';

interface OpeningTransitionProps {
  hasConversation: boolean;
  onComplete: () => void;
}

type Phase = 'idle' | 'expanded' | 'docking';

export function OpeningTransition({
  hasConversation,
  onComplete,
}: OpeningTransitionProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const completionTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(completionTimer.current);
  }, []);

  const prefersReducedMotion = () =>
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** 第一次点击：圆标展开成与图标等高的宽条，停在原位 */
  const expand = () => {
    if (phase !== 'idle') return;
    setPhase('expanded');
  };

  /** 第二次点击输入条：下移到正常输入框位置并交接 */
  const dock = () => {
    if (phase !== 'expanded') return;
    setPhase('docking');
    completionTimer.current = window.setTimeout(
      onComplete,
      prefersReducedMotion() ? 60 : 760,
    );
  };

  const handleClick = () => {
    if (phase === 'idle') expand();
    else if (phase === 'expanded') dock();
  };

  return (
    <div
      className={`opening-transition${
        hasConversation ? ' opening-transition--history' : ''
      }`}
    >
      <button
        type="button"
        className={`opening-trigger${phase !== 'idle' ? ' is-opening' : ''}${
          phase === 'docking' ? ' is-docking' : ''
        }`}
        onClick={handleClick}
        aria-label={phase === 'idle' ? '打开 Pi Agent 对话' : '开始输入'}
        aria-expanded={phase !== 'idle'}
      >
        <span className="opening-trigger__surface" aria-hidden="true" />
        <svg
          className="opening-trigger__glyph"
          viewBox="0 0 96 96"
          aria-hidden="true"
        >
          <path className="opening-stroke opening-stroke--stem" d="M27 70V27" />
          <path
            className="opening-stroke opening-stroke--bowl"
            d="M27 28H47C60 28 60 48 47 48H27"
          />
          <path className="opening-stroke opening-stroke--i" d="M68 45V70" />
          <circle
            className="opening-stroke opening-stroke--dot"
            cx="68"
            cy="30"
            r="3"
          />
        </svg>
        <span className="opening-trigger__prompt" aria-hidden="true">
          给 Pi 发送消息…
        </span>
        <span className="opening-trigger__send" aria-hidden="true">
          <span />
        </span>
      </button>
    </div>
  );
}
