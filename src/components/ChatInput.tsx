import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, Loader2, Paperclip, Square, X } from 'lucide-react';
import type { AttachmentContent, DirEntry, DirListing } from '../types/pi';
import {
  base64ToFile,
  baseName,
  formatBytes,
  isImageFile,
  isImagePath,
  prepareImageAttachment,
  readInlineText,
  type PendingAttachment,
  type PromptDraft,
  type UploadedFile,
} from '../utils/attachments';
import { FilePicker } from './FilePicker';
import { FileIcon } from './FileIcon';
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
  /** 弹系统原生的文件选择框，拿回绝对路径（不复制文件） */
  onPickFile?: (imagesOnly?: boolean) => Promise<string[]>;
  /** 列工作目录，用于「从项目里选」 */
  onListDir?: (path: string) => Promise<DirListing>;
  /** 读附件内容：文本内联、图片 base64、二进制只报大小 */
  onReadAttachment?: (path: string) => Promise<AttachmentContent>;
  /** 落盘通道。只在拖进来一个二进制文件时用得上（那时拿不到路径） */
  onUploadFile?: (file: File) => Promise<UploadedFile>;
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
  onPickFile,
  onListDir,
  onReadAttachment,
  onUploadFile,
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
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

  const newId = () => `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const patch = (id: string, changes: Partial<PendingAttachment>) => {
    setAttachments(prev => prev.map(item => (item.id === id ? { ...item, ...changes } : item)));
  };

  /**
   * 文本文件把内容读出来内联——模型一眼就看到，不必先花一轮去调 read。
   * 读失败也当作普通文件，不影响附件本身。
   */
  const loadContent = useCallback(
    async (id: string, path: string) => {
      if (!onReadAttachment) return;

      try {
        const result = await onReadAttachment(path);
        if (result.kind !== 'text') return;

        setAttachments(prev =>
          prev.map(item =>
            item.id === id
              ? { ...item, content: result.text, truncated: result.truncated, bytes: result.bytes }
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
   * 处理**文件对象**（拖拽 / 粘贴进来的）。
   *
   * 这些文件只有名字，没有路径——浏览器不会告诉我们。所以：
   *  - 图片：读成 base64 走原生附件，不落盘
   *  - 文本：内容直接在浏览器里读出来内联，**也不落盘**
   *  - 其它（docx / pdf 等二进制）：没办法，只能走落盘通道
   */
  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      for (const file of files) {
        const id = newId();
        const kind = isImageFile(file) ? 'image' : 'file';
        setAttachments(prev => [
          ...prev,
          { id, name: file.name || 'file', bytes: file.size, kind, status: 'loading' },
        ]);

        try {
          if (kind === 'image') {
            const prepared = await prepareImageAttachment(file);
            patch(id, { ...prepared, status: 'ready' });
            continue;
          }

          const inline = await readInlineText(file);
          if (inline) {
            patch(id, { content: inline.text, truncated: inline.truncated, status: 'ready' });
            continue;
          }

          if (!onUploadFile) throw new Error('这个文件需要落盘通道，但当前不可用');
          const uploaded = await onUploadFile(file);
          patch(id, { status: 'ready', name: uploaded.name, bytes: uploaded.bytes, path: uploaded.relativePath });
          void loadContent(id, uploaded.relativePath);
        } catch (error) {
          patch(id, { status: 'error', error: (error as Error).message });
        }
      }
    },
    [onUploadFile, loadContent]
  );

  /**
   * 从系统对话框选。**文件一个字节都不复制**——桥接拿回真实路径，我们只是
   * 把路径记下来，需要内容（文本/图片）时才去读那一个文件。
   */
  const addFromComputer = useCallback(async () => {
    if (!onPickFile) return;

    let paths: string[];
    try {
      paths = await onPickFile();
    } catch (error) {
      const id = newId();
      // 没有文件名可显示时，把原因本身当成标签——比干巴巴一个「失败」有用
      setAttachments(prev => [
        ...prev,
        {
          id,
          name: (error as Error).message,
          bytes: 0,
          kind: 'file',
          status: 'error',
          error: (error as Error).message,
        },
      ]);
      return;
    }

    for (const absolute of paths) {
      const id = newId();
      const image = isImagePath(absolute);
      setAttachments(prev => [
        ...prev,
        { id, name: baseName(absolute), bytes: 0, kind: image ? 'image' : 'file', status: 'loading' },
      ]);

      try {
        const content = await onReadAttachment?.(absolute);
        if (content?.kind === 'image') {
          // 图片要真的发给模型，所以在浏览器里重新走一遍缩放管线
          const file = base64ToFile(content.data, baseName(absolute), content.mimeType);
          const prepared = await prepareImageAttachment(file);
          patch(id, { ...prepared, bytes: content.bytes, status: 'ready' });
        } else if (content?.kind === 'text') {
          patch(id, {
            path: absolute,
            content: content.text,
            truncated: content.truncated,
            bytes: content.bytes,
            status: 'ready',
          });
        } else {
          patch(id, { path: absolute, bytes: content?.bytes ?? 0, status: 'ready' });
        }
      } catch (error) {
        patch(id, { path: absolute, status: 'error', error: (error as Error).message });
      }
    }
  }, [onPickFile, onReadAttachment]);

  /** 从工作目录挑：文件已经在磁盘上，连内容都不必复制 */
  const addFromWorkspace = (entry: DirEntry) => {
    const id = newId();
    const image = isImagePath(entry.path);

    setAttachments(prev => [
      ...prev,
      {
        id,
        name: entry.name,
        bytes: entry.bytes ?? 0,
        kind: image ? 'image' : 'file',
        status: 'loading',
        path: entry.path,
      },
    ]);
    setPickerOpen(false);

    if (image) {
      // 工作目录里的图片同样需要 base64 才能走原生通道
      void (async () => {
        try {
          const content = await onReadAttachment?.(entry.path);
          if (content?.kind !== 'image') throw new Error('读不到这张图片');
          const file = base64ToFile(content.data, entry.name, content.mimeType);
          patch(id, { ...(await prepareImageAttachment(file)), bytes: content.bytes, status: 'ready' });
        } catch (error) {
          patch(id, { status: 'error', error: (error as Error).message });
        }
      })();
      return;
    }

    void loadContent(id, entry.path);
    patch(id, { status: 'ready' });
  };

  /**
   * 拖拽监听挂在**整个窗口**上，而不是只挂在输入框那一条。
   *
   * 之前只给输入区加了 onDrop，而对话区和它是兄弟节点，所以把文件拖到上面
   * 什么都不会发生——用户的第一反应就是往对话区拖。
   *
   * 另外还必须 preventDefault：不然浏览器默认行为是直接打开这个文件，
   * 整个页面会被替掉。
   */
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragging(true);
    };

    const onDragLeave = (event: DragEvent) => {
      // dragleave 会在子元素之间反复触发；只有目标不在页面里了才算真的离开窗口
      const next = event.relatedTarget as Node | null;
      if (!next || !document.contains(next)) setDragging(false);
    };

    const onDrop = (event: DragEvent) => {
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      event.preventDefault();
      setDragging(false);
      void addFiles(files);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  const removeAttachment = (id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
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

    onSend({ text: input, images, files });
    setInput('');
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const activate = () => {
    if (showIcon) onActivate?.();
  };

  const canAttach = !!onPickFile || !!onListDir;

  return (
    <div className="w-full max-w-content mx-auto px-5 sm:px-6 pb-6 sm:pb-8">
      {/* 拖拽提示：铺满整个视口，明确告诉用户“松手就会加进来” */}
      {dragging &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[135] flex items-center justify-center bg-background/80">
            <div className="flex items-center gap-2 rounded-2xl border-2 border-dashed border-muted/40 bg-background px-8 py-6 text-[13.5px] text-muted shadow-[0_8px_32px_-12px_rgba(0,0,0,0.25)]">
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
            className="w-full resize-none bg-transparent py-3.5 pl-4 pr-24 text-[14.5px] leading-[1.7] text-foreground placeholder:text-[color:var(--placeholder)] focus:outline-none max-h-48"
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
