import { useEffect, useRef, useState } from 'react';
import './OpeningTransition.css';

interface OpeningTransitionProps {
  hasConversation: boolean;
  onComplete: () => void;
}

export function OpeningTransition({
  hasConversation,
  onComplete,
}: OpeningTransitionProps) {
  const [opening, setOpening] = useState(false);
  const completionTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    return () => window.clearTimeout(completionTimer.current);
  }, []);

  const open = () => {
    if (opening) return;

    setOpening(true);
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    completionTimer.current = window.setTimeout(
      onComplete,
      reduceMotion ? 60 : 1080,
    );
  };

  return (
    <div
      className={`opening-transition${
        hasConversation ? ' opening-transition--history' : ''
      }`}
    >
      <button
        type="button"
        className={`opening-trigger${opening ? ' is-opening' : ''}`}
        onClick={open}
        aria-label="打开 Pi Agent 对话"
        aria-expanded={opening}
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
