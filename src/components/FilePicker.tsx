import { useEffect, useState } from 'react';
import type { DirEntry, DirListing } from '../types/pi';
import { ChevronLeft, FileText, Folder, X } from 'lucide-react';
import { formatBytes } from '../utils/attachments';

interface FilePickerProps {
  /** 列目录。路径省略 = 工作目录根 */
  onList: (path: string) => Promise<DirListing>;
  onPick: (entry: DirEntry) => void;
  onClose: () => void;
}

/**
 * 从工作目录里挑文件（而不是把字节传一遍）。
 *
 * 浏览器不会把本地路径告诉页面，但我们本来也不需要：文件已经在磁盘上了，
 * 把它的相对路径插进消息就行。这也是 Codex 的 /mention 的做法。
 * 代价只是要能列出目录——由桥接提供，且只允许看工作目录里面。
 */
export function FilePicker({ onList, onPick, onClose }: FilePickerProps) {
  const [path, setPath] = useState('');
  /**
   * 只存「已经拿到的结果」，并且记住它是哪条路径的。
   * 这样「载入中」是推导出来的（结果不是当前路径的），而不是在 effect 里 setState——
   * 那样会多一轮渲染，也容易在快速切换目录时脏读。
   */
  const [loaded, setLoaded] = useState<{
    forPath: string;
    listing: DirListing | null;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    onList(path)
      .then(next => {
        if (!cancelled) setLoaded({ forPath: path, listing: next, error: null });
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setLoaded({ forPath: path, listing: null, error: (cause as Error).message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [path, onList]);

  const loading = loaded?.forPath !== path;
  const listing = loading ? null : (loaded?.listing ?? null);
  const error = loading ? null : (loaded?.error ?? null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const canGoUp = listing !== null && listing.parent !== null;
  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      aria-label="从工作目录选择文件"
    >
      <div className="absolute inset-0 bg-foreground/10" onClick={onClose} />

      <div className="paper-in relative flex max-h-[70vh] w-[26rem] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-[0_4px_24px_-8px_rgba(0,0,0,0.18)]">
        <div className="flex items-center gap-1.5 border-b border-border px-3 py-2.5">
          <button
            onClick={() => setPath(listing?.parent ?? '')}
            disabled={!canGoUp}
            aria-label="上一级"
            title="上一级"
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted">
            {path || '工作目录'}
          </span>

          <button
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md p-1 text-muted transition-colors hover:bg-surface hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {loading && <p className="px-3 py-4 text-[12px] text-muted">载入中…</p>}
          {!loading && error && <p className="px-3 py-4 text-[12px] text-rose-500">{error}</p>}
          {!loading && !error && listing?.entries.length === 0 && (
            <p className="px-3 py-4 text-[12px] text-muted">这个目录里没有可列出的文件</p>
          )}

          {!error &&
            listing?.entries.map(entry => (
              <button
                key={entry.path}
                onClick={() => (entry.isDir ? setPath(entry.path) : onPick(entry))}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-surface"
              >
                {entry.isDir ? (
                  <Folder className="w-3.5 h-3.5 shrink-0 text-muted" />
                ) : (
                  <FileText className="w-3.5 h-3.5 shrink-0 text-muted" />
                )}
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground/90">
                  {entry.name}
                </span>
                {!entry.isDir && entry.bytes !== undefined && (
                  <span className="shrink-0 text-[10.5px] text-muted">{formatBytes(entry.bytes)}</span>
                )}
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
