import { useState, useRef, useEffect } from 'react';
import { ArrowUp, Clock, Paperclip, Square } from 'lucide-react';
import type { AttachmentContent, DirListing } from '../types/pi';
import type { PromptDraft, UploadedFile } from '../utils/attachments';
import { useComposerAttachments } from '../hooks/useComposerAttachments';
import { useComposerHeight } from '../hooks/useComposerHeight';
import { ComposerAttachments } from './ComposerAttachments';
import { FilePicker } from './FilePicker';
import './ChatInput.css';

interface ChatInputProps {
  onSend: (draft: PromptDraft, options?: { queue?: boolean }) => void;
  onStop: () => void;
  isLoading: boolean;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
  /** 开场图标态：与展开后的输入框是同一个元素，点击后原地形变 */
  showIcon?: boolean;
  onActivate?: () => void;
  /** 外壳高度变化（多行输入）时通知父级，便于贴底时重新对齐滚动位置 */
  onResize?: () => void;
  /** 中断后取回的排队文本；seq 变化才消费一次 */
  restoredDraft?: { text: string; seq: number };
  /** 弹系统原生的文件选择框，拿回绝对路径（不复制文件） */
  onPickFile?: (imagesOnly?: boolean) => Promise<string[]>;
  /** 列工作目录，用于「从项目里选」 */
  onListDir?: (path: string) => Promise<DirListing>;
  /** 读附件内容：文本内联、图片 base64、二进制只报大小 */
  onReadAttachment?: (path: string) => Promise<AttachmentContent>;
  /** 落盘通道。只在拖进来一个二进制文件时用得上（那时拿不到路径） */
  onUploadFile?: (file: File) => Promise<UploadedFile>;
}

/**
 * 底部的输入框。
 *
 * 这里只留三件事：打字、发送（含生成中排队），以及把三块拼起来：
 *  - 附件逻辑 → useComposerAttachments
 *  - 高度自适应与开场形变 → useComposerHeight
 *  - 附件条 UI → ComposerAttachments
 */
export function ChatInput({
  onSend,
  onStop,
  isLoading,
  onFocusChange,
  autoFocus,
  showIcon = false,
  onActivate,
  onResize,
  restoredDraft,
  onPickFile,
  onListDir,
  onReadAttachment,
  onUploadFile,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  const { attachments, dragging, addFiles, addFromComputer, addFromWorkspace, remove, clear } =
    useComposerAttachments({ onPickFile, onReadAttachment, onUploadFile });

  useComposerHeight({ textareaRef, stageRef, showIcon, value: input, onResize });

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus();
  }, [autoFocus]);

  // 展开后自动聚焦：点开图标即可直接输入，不必再点一次。
  // 注意这里不触发展开下移——下移只由用户主动点击输入框触发。
  useEffect(() => {
    if (showIcon) return;
    textareaRef.current?.focus();
  }, [showIcon]);

  /** 已消费的 restoredDraft 序号，避免同一段取回的文本被反复写回输入框 */
  const consumedDraftSeqRef = useRef(0);

  /**
   * 中断后取回的排队文本写回输入框，让用户可以改一改再发。
   * 只在 seq 变化时消费一次，否则用户接着编辑会被这段文本盖回去。
   */
  useEffect(() => {
    if (!restoredDraft || restoredDraft.seq === consumedDraftSeqRef.current) return;
    consumedDraftSeqRef.current = restoredDraft.seq;
    setInput(restoredDraft.text);
    textareaRef.current?.focus();
  }, [restoredDraft]);

  const canSend = !!input.trim() || attachments.some(item => item.status === 'ready');

  const handleSend = () => {
    const ready = attachments.filter(item => item.status === 'ready');
    const images = ready
      .filter(item => item.kind === 'image' && item.data && item.mimeType)
      .map(item => ({
        name: item.name,
        data: item.data as string,
        mimeType: item.mimeType as string,
      }));
    const files = ready
      .filter(item => item.kind === 'file' && (item.path || item.content !== undefined))
      .map(item => ({
        name: item.name,
        path: item.path,
        content: item.content,
        truncated: item.truncated,
      }));

    if (!input.trim() && images.length === 0 && files.length === 0) return;

    onSend({ text: input, images, files }, { queue: isLoading });
    setInput('');
    clear();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法选词时的 Enter 不触发发送
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.length === 0) return;

    // 截图直接粘进来：拦掉默认行为，否则文件名会被当文本插进输入框
    e.preventDefault();
    void addFiles(files);
  };

  const activate = () => {
    if (showIcon) onActivate?.();
  };

  const canAttach = !!onPickFile || !!onListDir;

  return (
    <div className="w-full max-w-content mx-auto px-5 sm:px-6 pb-6 sm:pb-8">
      <ComposerAttachments attachments={attachments} dragging={dragging} onRemove={remove} />

      <div className="pi-stage rounded-2xl" ref={stageRef}>
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
            onPaste={handlePaste}
            onPointerDown={() => onFocusChange?.(true)}
            placeholder="给 Pi 发送消息…"
            rows={1}
            tabIndex={showIcon ? -1 : undefined}
            className="w-full resize-none bg-transparent py-3.5 pl-4 pr-24 text-[13.5px] leading-[1.7] text-foreground placeholder:text-[color:var(--placeholder)] focus:outline-none max-h-48"
          />

          <div className="pi-controls absolute right-2 bottom-2 flex items-center gap-1">
            {canAttach && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(open => !open)}
                  className="block p-2 rounded-full text-muted transition-colors hover:text-foreground"
                  title="添加附件"
                  aria-label="添加附件"
                  aria-expanded={menuOpen}
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {menuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                    <div className="absolute bottom-full right-0 z-50 mb-2 w-52 overflow-hidden rounded-lg border border-border bg-background py-1 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.18)]">
                      {onPickFile && (
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            void addFromComputer();
                          }}
                          className="block w-full px-3 py-1.5 text-left text-[12.5px] text-foreground/90 transition-colors hover:bg-surface"
                        >
                          从电脑选择…
                        </button>
                      )}
                      {onListDir && (
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            setPickerOpen(true);
                          }}
                          className="block w-full px-3 py-1.5 text-left text-[12.5px] text-foreground/90 transition-colors hover:bg-surface"
                        >
                          从项目里选择…
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* 生成中「中断」是主按钮（那时用户最可能想停下来）；
                输入框有内容时旁边再给一个「排队发送」，否则只剩中断。 */}
            {isLoading && (
              <button
                onClick={onStop}
                className="p-2 rounded-full bg-foreground text-background transition-opacity hover:opacity-80"
                title="中断（会收回还没被回答的消息）"
                aria-label="中断"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
              </button>
            )}

            {(!isLoading || canSend) && (
              <button
                onClick={handleSend}
                disabled={!canSend}
                className={`p-2 rounded-full transition-all duration-150 ${
                  canSend
                    ? 'bg-foreground text-background hover:opacity-80'
                    : 'text-muted/40 cursor-default'
                }`}
                title={isLoading ? '排队发送（当前回答结束后处理）' : '发送'}
                aria-label={isLoading ? '排队发送' : '发送'}
              >
                {isLoading ? (
                  <Clock className="w-4 h-4" />
                ) : (
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {pickerOpen && onListDir && (
        <FilePicker
          onList={onListDir}
          onPick={entry => {
            addFromWorkspace(entry);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
