import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * 居中的弹窗。点遮罩、按 Esc 都关闭。
 *
 * **必须用传送门挂到 body 上**，不能就地渲染：页面上的新消息带着 `.paper-in`
 * 入场动画，而它用了 `animation-fill-mode: both`——播完之后元素上仍然留着
 * `transform: translateY(0)`。只要有 transform，里面的 `position: fixed` 就不再
 * 相对视口，而是相对那个元素：遮罩只盖住一块，宽高百分比也会失效。
 * （和 ImageLightbox 同一个坑，那边有更长的说明。）
 */
export function Modal({ title, onClose, children }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/30 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      {/* 点面板本身不该关掉，所以拦住冒泡 */}
      <div
        onClick={event => event.stopPropagation()}
        className="paper-in max-h-[85vh] w-full max-w-md overflow-y-auto rounded-xl border border-border bg-background px-5 py-4 shadow-[0_8px_40px_-8px_rgba(0,0,0,0.25)]"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-[13px] font-medium text-foreground">{title}</h2>
          <button
            onClick={onClose}
            className="-mr-1 rounded-md p-1 text-muted transition-colors hover:text-foreground"
            aria-label="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
