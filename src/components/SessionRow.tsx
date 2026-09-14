import { useState } from 'react';
import type { SessionSummary } from '../types/pi';
import { Pencil, Trash2 } from 'lucide-react';
import { formatRelativeTime, projectName } from '../utils/format';

interface SessionRowProps {
  session: SessionSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (name: string) => void;
  /** 删除即移入回收箱，可以撤销，所以不再需要二次确认 */
  onDelete: () => void;
}

export function SessionRow({ session, active, onOpen, onRename, onDelete }: SessionRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  const title = session.name || session.preview || '未命名对话';
  const project = projectName(session.cwd);

  const startRename = () => {
    setDraft(session.name || session.preview || '');
    setRenaming(true);
  };

  const submitRename = () => {
    const next = draft.trim();
    setRenaming(false);
    if (next && next !== session.name) onRename(next);
  };

  if (renaming) {
    return (
      <li>
        <input
          autoFocus
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') submitRename();
            if (event.key === 'Escape') setRenaming(false);
          }}
          onBlur={submitRename}
          aria-label="重命名对话"
          className="w-full rounded-md bg-surface px-2.5 py-2 text-[12px] text-foreground outline-none ring-1 ring-border focus:ring-foreground/30"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        onClick={onOpen}
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
          {project && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">{project}</span>
            </>
          )}
        </div>
      </button>

      {/* 悬停显现；触屏没有 hover，因此窄屏常显 */}
      <div className="absolute right-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 max-sm:opacity-100">
        <button
          onClick={startRename}
          className="rounded p-1 text-muted transition-colors hover:bg-surface hover:text-foreground"
          aria-label="重命名"
          title="重命名"
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          onClick={onDelete}
          disabled={active}
          className="rounded p-1 text-muted transition-colors hover:bg-surface hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="删除"
          title={active ? '当前对话不能删除' : '删除（移入回收箱）'}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </li>
  );
}
