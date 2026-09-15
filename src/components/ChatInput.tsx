import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { ArrowUp, FileText, FolderOpen, Loader2, Paperclip, Square, X } from 'lucide-react';
import type { DirEntry, DirListing } from '../types/pi';
import type { AttachmentText } from '../hooks/usePiWebSocket';
import { FilePicker } from './FilePicker';
import {
  formatBytes,
  isImageFile,
  prepareImageAttachment,
  type PendingAttachment,
  type PromptDraft,
  type UploadedFile,
} from '../utils/attachments';
import './ChatInput.css';

/** 单行时外壳的高度 */
const COMPOSER_MIN_HEIGHT = 53;
/** 长高的上限，与 textarea 的 max-h-48 保持一致 */
const COMPOSER_MAX_HEIGHT = 192;
/** 开场形变时长，覆盖 CSS 里最长的过渡 */
const MORPH_MS = 760;

interface ChatInputProps {
  onSend: (draft: PromptDraft) => void;
  onStop: () => void;
  isLoading: boolean;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
  /** 开场图标态：与展开后的输入框是同一个元素，点击后原地形变 */
  showIcon?: boolean;
  onActivate?: () => void;
  /** 外壳高度变化（多行输入）时通知父级，便于贴底时重新对齐滚动位置 */
  onResize?: () => void;
  /** 把文件交给桥接落到工作目录；不传就不显示附件入口 */
  onUploadFile?: (file: File) => Promise<UploadedFile>;
  /** 列工作目录，用于「从工作目录选文件」；不传就不显示那个入口 */
  onListDir?: (path: string) => Promise<DirListing>;
  /** 把文件当文本读出来（内联进 prompt）；不传则文件只给路径 */
  onReadAttachment?: (path: string) => Promise<AttachmentText>;
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
  onUploadFile,
  onListDir,
  onReadAttachment,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  /**
   * 文本文件把内容读出来内联——模型一眼就看到，不必先花一轮去调 read。
   * 二进制文件会回 binary: true，保留路径即可；读失败也当作普通文件，不影响附件本身。
   */
  const loadContent = useCallback(
    async (id: string, relativePath: string) => {
      if (!onReadAttachment) return;

      try {
        const result = await onReadAttachment(relativePath);
        if (result.binary || typeof result.text !== 'string') return;

        setAttachments(prev =>
          prev.map(item =>
            item.id === id
              ? {
                  ...item,
                  content: result.text,
                  truncated: result.truncated,
                  bytes: result.bytes ?? item.bytes,
                }
              : item
          )
        );
      } catch {
        // 读不到就当普通文件处理
      }
    },
    [onReadAttachment]
  );

  /**
   * 逐个处理。串行是故意的：顺序稳定，附件条的排列与用户拖进来的顺序一致。
   * 单个失败只影响那一个，不打断其余的。
   *
   * 图片**不上传**：直接读成 base64 走 pi 的原生附件通道，模型才真的「看得见」。
   * 其它文件没有原生通道，只能先落盘换一个路径（文本还会额外内联内容）。
   */
  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      if (!onUploadFile) return;

      for (const file of files) {
        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const kind = isImageFile(file) ? 'image' : 'file';
        setAttachments(prev => [
          ...prev,
          { id, name: file.name || 'file', bytes: file.size, kind, status: 'uploading' },
        ]);

        try {
          if (kind === 'image') {
            const prepared = await prepareImageAttachment(file);
            setAttachments(prev =>
              prev.map(item => (item.id === id ? { ...item, ...prepared, status: 'ready' } : item))
            );
          } else {
            const uploaded = await onUploadFile(file);
            setAttachments(prev =>
              prev.map(item =>
                item.id === id
                  ? {
                      ...item,
                      status: 'ready',
                      name: uploaded.name,
                      bytes: uploaded.bytes,
                      relativePath: uploaded.relativePath,
                    }
                  : item
              )
            );
            void loadContent(id, uploaded.relativePath);
          }
        } catch (error) {
          setAttachments(prev =>
            prev.map(item =>
              item.id === id
                ? { ...item, status: 'error', error: (error as Error).message }
                : item
            )
          );
        }
      }
    },
    [onUploadFile, loadContent]
  );

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  };

  /** 从工作目录挑的文件：只记路径，不需要传输字节 */
  const addFromWorkspace = (entry: DirEntry) => {
    const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAttachments(prev => [
      ...prev,
      {
        id,
        name: entry.name,
        bytes: entry.bytes ?? 0,
        kind: 'file',
        status: 'ready',
        relativePath: entry.path,
      },
    ]);
    setPickerOpen(false);
    void loadContent(id, entry.path);
  };

  const canSend = !!input.trim() || attachments.some(item => item.status === 'ready');

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

  const handleSend = () => {
    if (isLoading) return;

    const ready = attachments.filter(item => item.status === 'ready');
    const images = ready
      .filter(item => item.kind === 'image' && item.data && item.mimeType)
      .map(item => ({ name: item.name, data: item.data as string, mimeType: item.mimeType as string }));
    const files = ready
      .filter(item => item.kind === 'file' && item.relativePath)
      .map(item => ({
        name: item.name,
        relativePath: item.relativePath as string,
        content: item.content,
        truncated: item.truncated,
      }));

    if (!input.trim() && images.length === 0 && files.length === 0) return;

    // 交给 usePiWebSocket 分流：图片走 prompt.images，文件把路径写进正文
    onSend({ text: input, images, files });
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const activate = () => {
    if (showIcon) onActivate?.();
  };

  return (
    <div
      className="w-full max-w-2xl mx-auto px-5 sm:px-6 pb-6 sm:pb-8"
      onDragOver={e => {
        if (!onUploadFile) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        if (!onUploadFile) return;
        e.preventDefault();
        setDragging(false);
        void addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map(item => (
            <span
              key={item.id}
              title={item.error}
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
              ) : item.status === 'uploading' ? (
                <Loader2 className="w-3 h-3 shrink-0 animate-spin" />
              ) : (
                <FileText className="w-3 h-3 shrink-0" />
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
                onClick={() => removeAttachment(item.id)}
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

      <div
        className={`pi-stage rounded-2xl ${dragging ? 'ring-1 ring-foreground/25' : ''}`}
        ref={stageRef}
      >
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
            className="w-full resize-none bg-transparent py-3.5 pl-4 pr-28 text-[14.5px] leading-[1.7] text-foreground placeholder:text-[color:var(--placeholder)] focus:outline-none max-h-48"
          />

          <div className="pi-controls absolute right-2 bottom-2 flex items-center gap-1">
            {onUploadFile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={e => {
                    void addFiles(Array.from(e.target.files ?? []));
                    // 清空 value：否则连续选同一个文件不会再触发 change
                    e.target.value = '';
                  }}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="p-2 rounded-full text-muted transition-colors hover:text-foreground"
                  title="添加附件"
                  aria-label="添加附件"
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </>
            )}

            {onListDir && (
              <button
                onClick={() => setPickerOpen(true)}
                className="p-2 rounded-full text-muted transition-colors hover:text-foreground"
                title="从工作目录选择"
                aria-label="从工作目录选择"
              >
                <FolderOpen className="w-4 h-4" />
              </button>
            )}

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

      {pickerOpen && onListDir && (
        <FilePicker
          onList={onListDir}
          onPick={addFromWorkspace}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
