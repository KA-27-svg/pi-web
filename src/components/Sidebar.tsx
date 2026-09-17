import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import { useRubberBandScroll } from '../hooks/useRubberBandScroll';
import { useRefreshFeedback } from '../hooks/useRefreshFeedback';
import { SessionRow } from './SessionRow';
import { TrashList } from './TrashList';
import {
  Check,
  FolderGit2,
  KeyRound,
  PanelLeftClose,
  RefreshCw,
  Search,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  status: BridgeStatus;
  onToggle: () => void;
  onNewSession: () => void;
  /** 打开模型供应商弹窗 */
  onOpenProviders: () => void;
  /** 打开工作目录弹窗 */
  onOpenCwd: () => void;
  onSwitchSession: (sessionPath: string) => void;
  onRenameSession: (sessionPath: string, name: string) => void;
  /** 删除 = 移入回收箱 */
  onDeleteSession: (sessionPath: string) => void;
  onRefreshSessions: () => void;
  onRequestTrash: () => void;
  onRestoreSession: (sessionPath: string) => void;
  onPurgeSession: (sessionPath: string) => void;
  onEmptyTrash: () => void;
}

type View = 'history' | 'trash';

interface Toast {
  text: string;
  tone: 'info' | 'error';
  /** 有值就显示「撤销」，用来把刚删掉的会话从回收箱拿回来 */
  undoPath?: string;
}

const UNDO_VISIBLE_MS = 10_000;

/** 正在输入时不要抢 `/` 和快捷键 */
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.isContentEditable
  );
}

/** 顶部那几个动作，长得都一样：图标 + 几个字，不堆别的 */
function Action({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-foreground/90 transition-colors hover:bg-surface"
    >
      {icon}
      {label}
    </button>
  );
}

export function Sidebar({
  open,
  status,
  onToggle,
  onNewSession,
  onOpenProviders,
  onOpenCwd,
  onSwitchSession,
  onRenameSession,
  onDeleteSession,
  onRefreshSessions,
  onRequestTrash,
  onRestoreSession,
  onPurgeSession,
  onEmptyTrash,
}: SidebarProps) {
  // 用 useMemo 稳住引用：status.sessions 缺失时 `?? []` 会每渲染产生新数组，
  // 让下面的 useMemo / useLayoutEffect 每次都白跑
  const sessions = useMemo(() => status.sessions ?? [], [status.sessions]);
  const trashed = useMemo(() => status.trashed ?? [], [status.trashed]);

  const [view, setView] = useState<View>('history');
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState<Toast | null>(null);
  const [dismissedNotice, setDismissedNotice] = useState<string | undefined>();

  /**
   * 刷新按钮的点击反馈。看的是「这一次刷新要等的那个值」：历史视图等 sessions，
   * 回收箱等 trashed。
   */
  const refresh = useRefreshFeedback(
    view === 'history' ? sessions : trashed,
    view === 'history' ? onRefreshSessions : onRequestTrash
  );

  const scrollRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);
  /** 每个视图各记一份滚动位置 */
  const scrollMemoryRef = useRef<Record<View, number>>({ history: 0, trash: 0 });

  const showToast = (next: Toast, autoHideMs?: number) => {
    window.clearTimeout(toastTimerRef.current);
    setToast(next);
    if (autoHideMs) {
      toastTimerRef.current = window.setTimeout(() => setToast(null), autoHideMs);
    }
  };

  const normalizedQuery = query.trim().toLowerCase();
  const visibleSessions = useMemo(() => {
    if (!normalizedQuery) return sessions;
    return sessions.filter(session => {
      const haystack = `${session.name ?? ''} ${session.preview} ${session.cwd ?? ''}`;
      return haystack.toLowerCase().includes(normalizedQuery);
    });
  }, [sessions, normalizedQuery]);

  const listCount = view === 'history' ? visibleSessions.length : trashed.length;

  // 到底/到顶后继续滚轮可以再拉出一段阻尼位移，松手回弹；拖滚动条不触发
  useRubberBandScroll(scrollRef, listRef, { enabled: listCount > 0 });

  // 收起再展开、切换视图、刷新列表之后回到原来的位置
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const remembered = scrollMemoryRef.current[view];
    if (el.scrollTop !== remembered) el.scrollTop = remembered;
  }, [view, sessions, trashed, query]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) scrollMemoryRef.current[view] = el.scrollTop;
  };

  // `/` 或 Ctrl/Cmd+K 聚焦搜索，选输入框或正文时让开
  useLayoutEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const isSlash = event.key === '/';
      const isPalette = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (!isSlash && !isPalette) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    // 搜索改变的是列表语义，从顶部重新看
    scrollMemoryRef.current.history = 0;
  };

  const handleDelete = (sessionPath: string) => {
    onDeleteSession(sessionPath);
    showToast({ text: '已移入回收箱 · 保留 30 天', tone: 'info', undoPath: sessionPath }, UNDO_VISIBLE_MS);
  };

  const switchToTrash = () => {
    setView('trash');
    onRequestTrash();
  };

  const notice =
    status.notice && status.notice !== dismissedNotice ? status.notice : undefined;
  const activeToast: Toast | null =
    toast ?? (notice ? { text: notice, tone: 'error' } : null);

  return (
    <aside
      aria-hidden={!open}
      className={`h-full shrink-0 overflow-hidden bg-surface/40 transition-[width] duration-300 ease-out max-sm:absolute max-sm:inset-y-0 max-sm:left-0 max-sm:z-[120] max-sm:bg-background max-sm:shadow-[0_0_24px_-6px_rgba(0,0,0,0.18)] ${
        open ? 'w-64 border-r border-border' : 'w-0'
      }`}
    >
      {/* 内层固定宽度，折叠时由外层裁切，避免内容被挤压变形 */}
      <div className="flex h-full w-64 flex-col">
        <div className="flex items-center justify-between px-3 pt-3 pb-2">
          <span className="flex items-center gap-2 pl-1">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-foreground font-mono text-[11px] text-background">
              Pi
            </span>
            <span className="text-[12.5px] font-medium text-foreground">Pi Agent</span>
          </span>
          <button
            onClick={onToggle}
            className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface hover:text-foreground"
            aria-label="收起侧栏"
            title="收起"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-0.5 px-3 pb-2">
          <Action
            icon={<SquarePen className="w-4 h-4" />}
            label="新建对话"
            onClick={onNewSession}
          />
          <Action
            icon={<KeyRound className="w-4 h-4" />}
            label="模型供应商"
            onClick={onOpenProviders}
          />
          <Action
            icon={<FolderGit2 className="w-4 h-4" />}
            label="工作目录"
            onClick={onOpenCwd}
          />
        </div>

        {view === 'history' && (
          <div className="px-3 pb-2">
            <div className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-1.5">
              <Search className="w-3.5 h-3.5 shrink-0 text-muted" />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={event => handleQueryChange(event.target.value)}
                placeholder="搜索对话…"
                aria-label="搜索历史对话"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
              />
              {query && (
                <button
                  onClick={() => handleQueryChange('')}
                  className="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-foreground"
                  aria-label="清空搜索"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between px-4 pt-1 pb-1">
          <span className="text-[11.5px] text-muted">
            {view === 'history' ? '历史对话' : '回收箱'}
          </span>
          <button
            onClick={refresh.trigger}
            disabled={refresh.phase === 'pending'}
            className="-mr-1 rounded-md p-1 text-muted transition-colors hover:text-foreground disabled:cursor-default"
            aria-label={view === 'history' ? '刷新历史对话' : '刷新回收箱'}
            title={refresh.phase === 'done' ? '已刷新' : '刷新'}
          >
            {/* 点下去就转，数据回来换成对勾停一下——否则列表没变的话，点了跟没点一个样 */}
            {refresh.phase === 'pending' ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : refresh.phase === 'done' ? (
              <Check className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        <nav
          ref={scrollRef}
          onScroll={handleScroll}
          className="scroll-visible min-h-0 flex-1 overflow-y-auto px-2 pb-3 [scrollbar-gutter:stable]"
        >
          <div ref={listRef}>
            {view === 'trash' ? (
              <TrashList
                items={trashed}
                onRestore={path => {
                  onRestoreSession(path);
                  showToast({ text: '已恢复到原位置', tone: 'info' }, UNDO_VISIBLE_MS);
                }}
                onPurge={onPurgeSession}
                onEmpty={onEmptyTrash}
              />
            ) : visibleSessions.length === 0 ? (
              <p className="px-2 py-3 text-[12px] text-muted">
                {sessions.length === 0
                  ? '暂无历史对话'
                  : `没有匹配「${query.trim()}」的对话`}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {visibleSessions.map(session => (
                  <SessionRow
                    key={session.path}
                    session={session}
                    active={session.id === status.sessionId}
                    onOpen={() => onSwitchSession(session.path)}
                    onRename={name => onRenameSession(session.path, name)}
                    onDelete={() => handleDelete(session.path)}
                  />
                ))}
              </ul>
            )}

            {view === 'history' && sessions.length > 0 && sessions.length < (status.sessionsTotal ?? 0) && (
              <p className="px-2 py-2 text-[11.5px] leading-[1.6] text-muted">
                只显示最近 {sessions.length} 条，共 {status.sessionsTotal} 条
              </p>
            )}
          </div>
        </nav>

        {activeToast && (
          <div className="border-t border-border px-3 py-2">
            <div className="flex items-start gap-2">
              <span
                className={`min-w-0 flex-1 text-[12px] leading-[1.6] ${
                  activeToast.tone === 'error' ? 'text-rose-500' : 'text-muted'
                }`}
              >
                {activeToast.text}
              </span>
              {activeToast.undoPath && (
                <button
                  onClick={() => {
                    onRestoreSession(activeToast.undoPath!);
                    setToast(null);
                  }}
                  className="shrink-0 text-[12px] text-foreground underline underline-offset-2 decoration-border transition-colors hover:decoration-foreground"
                >
                  撤销
                </button>
              )}
              <button
                onClick={() => {
                  setToast(null);
                  setDismissedNotice(status.notice);
                }}
                className="shrink-0 rounded p-0.5 text-muted transition-colors hover:text-foreground"
                aria-label="关闭提示"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="border-t border-border px-3 py-2">
          {view === 'trash' ? (
            <button
              onClick={() => setView('history')}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12px] text-muted transition-colors hover:bg-surface hover:text-foreground"
            >
              返回历史对话
            </button>
          ) : (
            <button
              onClick={switchToTrash}
              className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12px] text-muted transition-colors hover:bg-surface hover:text-foreground"
            >
              <Trash2 className="w-4 h-4" />
              回收箱
              {trashed.length > 0 && <span>({trashed.length})</span>}
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
