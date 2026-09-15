import { useState } from 'react';
import type { PiMessage } from '../types/pi';
import { MarkdownView } from './MarkdownView';
import { ExecutionCollapse } from './ExecutionCollapse';
import { ImageLightbox } from './ImageLightbox';
import { FileText } from 'lucide-react';

interface PiMessageItemProps {
  message: PiMessage;
  /** 点开文件附件时交给上层（桥接会用系统默认程序打开） */
  onOpenFile?: (path: string) => void;
}

export function PiMessageItem({ message, onOpenFile }: PiMessageItemProps) {
  /** 正在放大查看的图片；null 表示没开 */
  const [zoomed, setZoomed] = useState<{ src: string; alt: string } | null>(null);
  const isUser = message.role === 'user';
  const isStreaming = message.status === 'streaming';
  // 历史恢复出来的消息直接显示；入场动画只留给刚刚产生的那条
  const enter = message.fromHistory ? '' : 'paper-in';

  // 用户：右对齐，仅一层极淡底，无边框无阴影；
  // 附件单独一块——图片直接显示图片，文件显示成卡片（不再是一行路径文字）
  if (isUser) {
    const attachments = message.attachments ?? [];
    const hasText = message.content.length > 0;

    return (
      <div className={`${enter} flex flex-col items-end gap-2`}>
        {attachments.length > 0 && (
          <div className="flex max-w-[85%] flex-wrap justify-end gap-2">
            {attachments.map((attachment, index) =>
              attachment.kind === 'image' && attachment.dataUrl ? (
                <button
                  key={index}
                  onClick={() =>
                    setZoomed({ src: attachment.dataUrl as string, alt: attachment.name })
                  }
                  className="cursor-zoom-in"
                  title="点击放大"
                  aria-label={`放大查看 ${attachment.name}`}
                >
                  <img
                    src={attachment.dataUrl}
                    alt={attachment.name}
                    className="max-h-64 max-w-full rounded-xl border border-border object-contain"
                  />
                </button>
              ) : (
                <button
                  key={index}
                  onClick={() => attachment.path && onOpenFile?.(attachment.path)}
                  disabled={!attachment.path || !onOpenFile}
                  title={attachment.path ? `用默认程序打开\n${attachment.path}` : undefined}
                  className="flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-muted transition-colors enabled:hover:border-foreground/30 enabled:hover:text-foreground disabled:cursor-default"
                >
                  <FileText className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                </button>
              )
            )}
          </div>
        )}

        {hasText && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface px-4 py-2.5 text-[14.5px] leading-[1.7] whitespace-pre-wrap break-words">
            {message.content}
          </div>
        )}

        {zoomed && (
          <ImageLightbox
            src={zoomed.src}
            alt={zoomed.alt}
            onClose={() => setZoomed(null)}
          />
        )}
      </div>
    );
  }

  // Pi：左对齐，完全无容器，纯正文流
  return (
    <div className={enter}>
      <ExecutionCollapse
        reasoning={message.reasoning}
        tools={message.tools}
        isStreaming={isStreaming}
      />

      {message.content && <MarkdownView content={message.content} />}

      {message.error && (
        <p className="mt-2 text-[12.5px] leading-[1.7] text-rose-500 break-words">
          {message.error}
        </p>
      )}
    </div>
  );
}
