import { memo, useState } from 'react';
import type { HandoffMode, PiMessage } from '../types/pi';
import { MarkdownView } from './MarkdownView';
import { ExecutionCollapse } from './ExecutionCollapse';
import { ImageLightbox } from './ImageLightbox';
import { FileIcon } from './FileIcon';
import { formatClockTime } from '../utils/format';

interface PiMessageItemProps {
  message: PiMessage;
  /** 在这段消息里的下标，供右侧轨道定位（挂到根节点的 data-message-index 上） */
  dataIndex?: number;
  /** 点开文件附件时交给上层（桥接会用系统默认程序打开） */
  onOpenFile?: (path: string) => void;
  /** 当前会话的模型名：实时消息自己没记模型，用它兜底 */
  fallbackModel?: string;
  /** 模型 id → 显示名。历史消息只存了 id，靠它显示成人看得懂的名字 */
  modelNames?: Record<string, string>;
  /** 能把结论交给执行窗口时传它（只有顾问窗口传） */
  onHandoff?: (text: string, mode: HandoffMode) => Promise<string>;
}

function PiMessageItemBase({
  message,
  dataIndex,
  onOpenFile,
  fallbackModel,
  modelNames,
  onHandoff,
}: PiMessageItemProps) {
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
      <div data-message-index={dataIndex} className={`${enter} flex flex-col items-end gap-2`}>
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
                  className="flex max-w-[16rem] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-[12px] text-foreground transition-colors enabled:hover:border-foreground/40 disabled:cursor-default"
                >
                  <FileIcon name={attachment.name} />
                  <span className="truncate">{attachment.name}</span>
                </button>
              )
            )}
          </div>
        )}

        {hasText && (
          <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface px-4 py-2.5 text-[13.5px] leading-[1.7] whitespace-pre-wrap break-words">
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
  // 回答结束后末尾留一行小字：用的哪个模型、什么时候答的。
  const answerMeta = [
    message.model ? (modelNames?.[message.model] ?? message.model) : fallbackModel,
    formatClockTime(message.timestamp),
  ].filter(Boolean);

  return (
    <div data-message-index={dataIndex} className={enter}>
      <ExecutionCollapse
        reasoning={message.reasoning}
        tools={message.tools}
        isStreaming={isStreaming}
      />

      {message.content && <MarkdownView content={message.content} onHandoff={onHandoff} />}

      {message.error && (
        <p className="mt-2 text-[12.5px] leading-[1.7] text-rose-500 break-words">
          {message.error}
        </p>
      )}

      {/* 回答结束的安静标记。历史消息可能没有时间戳（为 0），这时只剩模型名 */}
      {!isStreaming && answerMeta.length > 0 && (
        <p data-answer-meta className="mt-2 text-[11px] text-muted">
          {answerMeta.join(' · ')}
        </p>
      )}
    </div>
  );
}

/**
 * 消息多时，父组件因为别的 state（开侧栏 / 设置面板）重渲染，不该让每条消息都跟着
 * 重新走一遍 markdown 解析与语法高亮。messages 里只有变化的那条会换新对象，
 * 所以 memo 一加，流式输出时也只有正在生成的那条重渲染。
 */
export const PiMessageItem = memo(PiMessageItemBase);
