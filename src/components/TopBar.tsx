import type { BridgeStatus } from '../types/pi';
import { FolderGit2, PlusCircle, Cpu, BrainCircuit } from 'lucide-react';

interface TopBarProps {
  status: BridgeStatus;
  onNewSession: () => void;
  hasMessages: boolean;
  onChangeCwd: (cwd: string) => void;
}

export function TopBar({
  status,
  onNewSession,
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
        {/* Logo */}
        <div className="flex items-center gap-1.5 font-bold tracking-tight text-base text-foreground font-mono">
          <span className="w-5 h-5 rounded-md bg-accent text-accent-foreground flex items-center justify-center text-xs">
            π
          </span>
          <span>pi-web</span>
        </div>

        {/* 连接状态 */}
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] bg-surface border border-border">
          <span
            className={`w-2 h-2 rounded-full ${
              status.connected
                ? 'bg-emerald-500 animate-pulse'
                : 'bg-rose-500'
            }`}
          />
          <span className="text-muted font-medium">
            {status.connected ? 'RPC 联机' : '未连接'}
          </span>
        </div>

        {/* 当前模型与思考强度指示器 (来自 Pi 本地原生 get_state) */}
        {status.model && (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-surface border border-border text-foreground font-mono">
            <Cpu className="w-3.5 h-3.5 text-accent" />
            <span className="font-medium text-[11px]">{status.model.name || status.model.id}</span>
            {status.thinkingLevel && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.2 rounded bg-surface-hover text-muted">
                <BrainCircuit className="w-3 h-3 text-purple-400" />
                {status.thinkingLevel}
              </span>
            )}
          </div>
        )}

        {/* 当前工作目录 */}
        {status.cwd && (
          <button
            onClick={handleEditCwd}
            title="点击切换工作目录"
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs bg-surface-hover/80 hover:bg-surface-hover text-muted hover:text-foreground border border-border/60 transition-colors max-w-xs truncate"
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
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-ping" />
            <span className="text-[11px] font-medium font-mono">
              {status.currentTool
                ? `RUN: ${status.currentTool}`
                : 'Pi 思考与决策中...'}
            </span>
          </div>
        )}

        {/* 新建会话按钮 */}
        <button
          onClick={onNewSession}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted hover:text-foreground hover:bg-surface-hover transition-colors border border-border/60"
          title="新建独立会话"
        >
          <PlusCircle className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[11px]">新建会话</span>
        </button>
      </div>
    </header>
  );
}
