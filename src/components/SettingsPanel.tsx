import { useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import { X, FolderGit2, PlusCircle } from 'lucide-react';

interface SettingsPanelProps {
  status: BridgeStatus;
  onClose: () => void;
  onChangeCwd: (cwd: string) => void;
  onNewSession: () => void;
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <span className="shrink-0 text-[11px] text-muted">{label}</span>
      <span className="min-w-0 truncate text-right text-[12.5px] font-mono text-foreground/90">
        {children}
      </span>
    </div>
  );
}

export function SettingsPanel({
  status,
  onClose,
  onChangeCwd,
  onNewSession,
}: SettingsPanelProps) {
  const [cwdDraft, setCwdDraft] = useState(status.cwd);

  const applyCwd = () => {
    const next = cwdDraft.trim();
    if (next && next !== status.cwd) onChangeCwd(next);
  };

  const contextK = status.model?.contextWindow
    ? `${(status.model.contextWindow / 1000).toFixed(0)}K`
    : '—';

  return (
    <>
      {/* 点击空白处关闭 */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div className="absolute right-4 top-14 z-50 w-[19rem] origin-top-right rounded-xl border border-border bg-background shadow-[0_4px_24px_-8px_rgba(0,0,0,0.12)] paper-in">
        <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
          <span className="text-[12px] font-medium text-foreground">设置</span>
          <button
            onClick={onClose}
            className="p-1 -mr-1 rounded-md text-muted hover:text-foreground transition-colors"
            aria-label="关闭"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* 运行时信息 */}
        <div className="px-4 pb-3">
          <div className="divide-y divide-border/70">
            <Row label="连接">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    status.connected ? 'bg-emerald-500' : 'bg-rose-400'
                  }`}
                />
                {status.connected ? 'RPC 联机' : '未连接'}
              </span>
            </Row>
            <Row label="模型">{status.model?.name || status.model?.id || '—'}</Row>
            <Row label="提供方">{status.model?.provider || '—'}</Row>
            <Row label="思考强度">{status.thinkingLevel || '—'}</Row>
            <Row label="上下文">{contextK}</Row>
          </div>
        </div>

        {/* 工作目录 */}
        <div className="border-t border-border px-4 py-3">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted">
            <FolderGit2 className="w-3 h-3" />
            工作目录
          </div>
          <div className="flex items-center gap-2">
            <input
              value={cwdDraft}
              onChange={e => setCwdDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') applyCwd();
              }}
              spellCheck={false}
              className="min-w-0 flex-1 rounded-md bg-surface px-2.5 py-1.5 font-mono text-[11.5px] text-foreground outline-none focus:bg-surface-hover transition-colors"
            />
            <button
              onClick={applyCwd}
              className="shrink-0 rounded-md px-2.5 py-1.5 text-[11.5px] text-muted hover:bg-surface hover:text-foreground transition-colors"
            >
              切换
            </button>
          </div>
        </div>

        {/* 新建会话 */}
        <div className="border-t border-border px-4 py-3">
          <button
            onClick={() => {
              onNewSession();
              onClose();
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-surface py-2 text-[12px] text-foreground/90 hover:bg-surface-hover transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            新建会话
          </button>
        </div>
      </div>
    </>
  );
}
