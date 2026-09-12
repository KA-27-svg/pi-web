import type { BridgeStatus } from '../types/pi';

interface TopBarProps {
  status: BridgeStatus;
  onNewSession: () => void;
  onChangeCwd: (cwd: string) => void;
}

/** 取路径最后一段，减少视觉噪音 */
function shortPath(p: string) {
  if (!p) return '';
  const parts = p.replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts[parts.length - 1] || p;
}

export function TopBar({ status, onNewSession, onChangeCwd }: TopBarProps) {
  const handleEditCwd = () => {
    const next = prompt('输入新的本地工作目录路径 (Path):', status.cwd);
    if (next && next.trim()) onChangeCwd(next.trim());
  };

  return (
    <header className="h-11 flex items-center justify-between gap-4 px-5 sm:px-6 text-[11px] text-muted select-none">
      {/* 左：状态 · 模型 · 思考强度 */}
      <div className="flex items-center gap-2.5 min-w-0">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            status.connected ? 'bg-emerald-500' : 'bg-rose-400'
          }`}
        />
        <span className="font-mono shrink-0">pi-web</span>

        {status.model && (
          <>
            <span className="opacity-30">·</span>
            <span className="font-mono truncate">
              {status.model.name || status.model.id}
            </span>
          </>
        )}

        {status.thinkingLevel && (
          <>
            <span className="opacity-30">·</span>
            <span className="font-mono shrink-0">{status.thinkingLevel}</span>
          </>
        )}
      </div>

      {/* 右：目录 · 新建会话 */}
      <div className="flex items-center gap-5 shrink-0">
        {status.cwd && (
          <button
            onClick={handleEditCwd}
            title={status.cwd}
            className="font-mono max-w-[20ch] truncate hover:text-foreground transition-colors"
          >
            {shortPath(status.cwd)}
          </button>
        )}
        <button
          onClick={onNewSession}
          className="hover:text-foreground transition-colors"
        >
          新建会话
        </button>
      </div>
    </header>
  );
}
