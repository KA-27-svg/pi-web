import type { BridgeStatus } from '../types/pi';
import { FolderGit2, RefreshCw, Activity } from 'lucide-react';

interface TopBarProps {
  status: BridgeStatus;
  onClearChat: () => void;
  hasMessages: boolean;
  onChangeCwd: (cwd: string) => void;
}

export function TopBar({
  status,
  onClearChat,
  hasMessages,
  onChangeCwd,
}: TopBarProps) {
  const handleEditCwd = () => {
    const next = prompt('输入新的本地工作目录路径 (Path):', status.cwd);
    if (next && next.trim()) {
      onChangeCwd(next.trim());
    }
  };

  return (
    <header className="sticky top-0 z-30 w-full flex items-center justify-between px-4 sm:px-6 py-2.5 bg-background/85 backdrop-blur-md border-b border-border transition-colors">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 font-bold tracking-tight text-base text-foreground font-mono">
          <span className="w-5 h-5 rounded-md bg-accent text-accent-foreground flex items-center justify-center text-xs">
            π
          </span>
          <span>pi-web</span>
        </div>

        {/* 连接状态指示 */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-surface border border-border">
          <span
            className={`w-2 h-2 rounded-full ${
              status.connected
                ? 'bg-emerald-500 animate-pulse'
                : 'bg-rose-500'
            }`}
          />
          <span className="text-muted font-medium">
            {status.connected ? 'RPC 联机' : '连接断开'}
          </span>
        </div>

        {/* 当前工作目录 */}
        {status.cwd && (
          <button
            onClick={handleEditCwd}
            title="点击切换工作目录"
            className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-surface-hover/80 hover:bg-surface-hover text-muted hover:text-foreground border border-border/60 transition-colors max-w-sm truncate"
          >
            <FolderGit2 className="w-3.5 h-3.5 text-accent flex-shrink-0" />
            <span className="truncate font-mono text-[11px]">{status.cwd}</span>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {/* 执行中状态提示 */}
        {status.isStreaming && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500 bg-amber-500/10 px-2.5 py-1 rounded-md border border-amber-500/20">
            <Activity className="w-3.5 h-3.5 animate-spin" />
            <span className="text-[11px] font-medium">
              {status.currentTool
                ? `执行工具: ${status.currentTool}`
                : 'Pi 正在思考执行...'}
            </span>
          </div>
        )}

        {hasMessages && (
          <button
            onClick={onClearChat}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            title="清空当前消息"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline text-[11px]">清屏</span>
          </button>
        )}
      </div>
    </header>
  );
}
