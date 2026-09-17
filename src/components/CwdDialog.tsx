import { useState } from 'react';
import { Modal } from './Modal';

interface CwdDialogProps {
  cwd: string;
  onClose: () => void;
  onChangeCwd: (cwd: string) => void;
}

/**
 * 工作目录。pi 会以新目录重启，所以切换前说清会发生什么。
 */
export function CwdDialog({ cwd, onClose, onChangeCwd }: CwdDialogProps) {
  const [draft, setDraft] = useState(cwd);

  const apply = () => {
    const next = draft.trim();
    if (next && next !== cwd) onChangeCwd(next);
    // 切换是异步的（pi 要重启），先关掉，状态由 cwd_changed 事件推回来
    onClose();
  };

  return (
    <Modal title="工作目录" onClose={onClose}>
      <p className="text-[12px] leading-[1.7] text-muted">
        pi 读写的文件都在这个目录下。切换会让 pi 以新目录重启。
      </p>

      <div className="mt-3 flex items-center gap-2">
        <input
          value={draft}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') apply();
          }}
          // 弹窗就是为了改它才打开的，所以直接聚焦
          autoFocus
          spellCheck={false}
          aria-label="工作目录"
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:bg-surface-hover"
        />
      </div>

      <div className="mt-3 flex justify-end">
        <button
          onClick={apply}
          disabled={!draft.trim() || draft.trim() === cwd}
          className="rounded-full bg-accent px-3.5 py-1.5 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
        >
          切换
        </button>
      </div>
    </Modal>
  );
}
