import { useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ImageLightboxProps {
  src: string;
  alt: string;
  onClose: () => void;
}

/**
 * 点开对话里的图片：铺满屏幕看原图。点图片外或图片内、按 Esc 都关闭。
 *
 * **必须用传送门挂到 body 上**，不能就地渲染。新消息带着 `.paper-in` 入场动画，
 * 而那个动画用了 `animation-fill-mode: both`——播完之后元素上仍然留着
 * `transform: translateY(0)`。只要有 transform，里面的 `position: fixed` 就不再
 * 相对视口，而是相对那个元素：
 *   - 遮罩只盖住消息那一块，不是整屏
 *   - `max-h-full` 要按容器高度算百分比，而容器高度是 auto，百分比失效，
 *     图片便按原始尺寸铺开（截图往往远大于屏幕）
 * 挂到 body 上就与任何被 transform 的祖先无关了。
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
    >
      {/* 尺寸用视口单位而不是百分比：不依赖父元素的高度是否可解 */}
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-[0_8px_40px_-8px_rgba(0,0,0,0.5)]"
      />
    </div>,
    document.body
  );
}
