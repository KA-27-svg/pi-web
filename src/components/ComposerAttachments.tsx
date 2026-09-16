import { createPortal } from 'react-dom';
import { Loader2, Paperclip, X } from 'lucide-react';
import { formatBytes, type PendingAttachment } from '../utils/attachments';
import { FileIcon } from './FileIcon';

interface ComposerAttachmentsProps {
  attachments: PendingAttachment[];
  /** 正在往窗口里拖文件：铺一层全屏提示 */
  dragging: boolean;
  onRemove: (id: string) => void;
}

/**
 * 输入框上方的附件条，外加拖拽时的全屏提示。
 *
 * 图片显示缩略图、文件显示图标 + 大小、文本显示「已内联」——
 * 用户要能一眼看出这个附件最终会以什么形式发给模型。
 */
export function ComposerAttachments({
  attachments,
  dragging,
  onRemove,
}: ComposerAttachmentsProps) {
  return (
    <>
      {/* 拖拽提示：铺满整个视口，明确告诉用户「松手就会加进来」 */}
      {dragging &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[135] flex items-center justify-center bg-background/80">
            <div className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-muted/40 bg-background px-8 py-6 text-[12.5px] text-muted shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)]">
              <Paperclip className="w-4 h-4 shrink-0" />
              松手以添加附件
            </div>
          </div>,
          document.body
        )}

      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map(item => (
            <span
              key={item.id}
              title={item.error ?? item.path}
              className={`flex max-w-[16rem] items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] ${
                item.status === 'error'
                  ? 'border-rose-400/40 text-rose-500'
                  : 'border-border text-muted'
              }`}
            >
              {item.kind === 'image' && item.dataUrl ? (
                <img
                  src={item.dataUrl}
                  alt={item.name}
                  className="h-4 w-4 shrink-0 rounded object-cover"
                />
              ) : item.status === 'loading' ? (
                <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
              ) : (
                <FileIcon name={item.name} className="w-3 h-3 shrink-0" />
              )}
              <span className="truncate">{item.name}</span>
              <span className="shrink-0 text-muted/70">
                {item.status === 'error'
                  ? '失败'
                  : item.content !== undefined
                    ? '已内联'
                    : formatBytes(item.bytes)}
              </span>
              <button
                onClick={() => onRemove(item.id)}
                className="shrink-0 rounded p-0.5 transition-colors hover:text-foreground"
                aria-label={`移除 ${item.name}`}
                title="移除"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
