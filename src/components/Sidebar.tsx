import { useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import {
  PanelLeftClose,
  SquarePen,
  RefreshCw,
  Pencil,
  Trash2,
  X,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  status: BridgeStatus;
  onToggle: () => void;
  onNewSession: () => void;
  onSwitchSession: (sessionPath: string) => void;
  onRenameSession: (sessionPath: string, name: string) => void;
  onDeleteSession: (sessionPath: string) => void;
  onRefreshSessions: () => void;
}

function formatRelativeTime(timestamp: number) {
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 天前`;

  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** 会话跨项目展示，用工作目录的最后一段做项目名 */
function projectName(cwd?: string) {
  if (!cwd) return undefined;
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1];
}

export function Sidebar({
  open,
  status,
  onToggle,
  onNewSession,
  onSwitchSession,
  onRenameSession,
  onDeleteSession,
  onRefreshSessions,
}: SidebarProps) {
  const sessions = status.sessions ?? [];
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingPath, setConfirmingPath] = useState<string | null>(null);

  const startRename = (path: string, current: string) => {
    setConfirmingPath(null);
    setRenamingPath(path);
    setRenameDraft(current);
  };

  const submitRename = (path: string) => {
    const next = renameDraft.trim();
    setRenamingPath(null);
    setRenameDraft('');
    if (next) onRenameSession(path, next);
  };

  const cancelRename = () => {
    setRenamingPath(null);
    setRenameDraft('');
  };

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
            <span className="grid h-6 w-6 place-items-center rounded-full bg-foreground font-mono text-[10px] text-background">
              Pi
            </span>
            <span className="text-[12px] font-medium text-foreground">
              Pi Agent
            </span>
          </span>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-md text-muted hover:text-foreground hover:bg-surface transition-colors"
            aria-label="收起侧栏"
            title="收起"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            onClick={onNewSession}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[12.5px] text-foreground/90 hover:bg-surface transition-colors"
          >
            <SquarePen className="w-3.5 h-3.5" />
            新建对话
          </button>
        </div>

        <div className="flex items-center justify-between px-4 pt-1 pb-1">
          <span className="text-[10.5px] text-muted">历史对话</span>
          <button
            onClick={onRefreshSessions}
            className="p-1 -mr-1 rounded-md text-muted hover:text-foreground transition-colors"
            aria-label="刷新历史对话"
            title="刷新"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {sessions.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-muted">暂无历史对话</p>
          ) : (
            <ul className="space-y-0.5">
              {sessions.map(session => {
                const active = session.id === status.sessionId;
                const title = session.name || session.preview || '未命名对话';
                const renaming = renamingPath === session.path;
                const confirming = confirmingPath === session.path;

                if (renaming) {
                  return (
                    <li key={session.path}>
                      <input
                        autoFocus
                        value={renameDraft}
                        onChange={e => setRenameDraft(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') submitRename(session.path);
                          if (e.key === 'Escape') cancelRename();
                        }}
                        onBlur={() => submitRename(session.path)}
                        aria-label="重命名对话"
                        className="w-full rounded-md bg-surface px-2.5 py-2 text-[12px] text-foreground outline-none ring-1 ring-border focus:ring-foreground/30"
                      />
                    </li>
                  );
                }

                return (
                  <li key={session.path} className="group relative">
                    <button
                      onClick={() => onSwitchSession(session.path)}
                      aria-current={active ? 'true' : undefined}
                      title={title}
                      className={`w-full rounded-md py-2 pl-2.5 pr-14 text-left transition-colors ${
                        active ? 'bg-surface-hover' : 'hover:bg-surface'
                      }`}
                    >
                      <div
                        className={`truncate text-[12px] ${
                          active ? 'text-foreground' : 'text-foreground/85'
                        }`}
                      >
                        {title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted">
                        <span>{formatRelativeTime(session.updatedAt)}</span>
                        {projectName(session.cwd) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">
                              {projectName(session.cwd)}
                            </span>
                          </>
                        )}
                      </div>
                    </button>

                    {/* 悬停显现；触屏没有 hover，因此窄屏常显 */}
                    <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100">
                      {confirming ? (
                        <>
                          <button
                            onClick={() => {
                              setConfirmingPath(null);
                              onDeleteSession(session.path);
                            }}
                            className="rounded px-1.5 py-1 text-[10px] text-rose-500 hover:bg-surface"
                            title="确认删除"
                          >
                            删除
                          </button>
                          <button
                            onClick={() => setConfirmingPath(null)}
                            className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
                            aria-label="取消删除"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startRename(session.path, session.name || session.preview || '')}
                            className="rounded p-1 text-muted hover:bg-surface hover:text-foreground transition-colors"
                            aria-label="重命名"
                            title="重命名"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => setConfirmingPath(session.path)}
                            disabled={active}
                            className="rounded p-1 text-muted hover:bg-surface hover:text-foreground transition-colors disabled:cursor-not-allowed disabled:opacity-30"
                            aria-label="删除"
                            title={active ? '当前对话不能删除' : '删除'}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </div>
    </aside>
  );
}
