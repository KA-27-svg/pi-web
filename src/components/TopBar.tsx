import { Settings as SettingsIcon, Trash2 } from 'lucide-react';
import type { Settings } from '../types';

interface TopBarProps {
  settings: Settings;
  onOpenSettings: () => void;
  onClearChat: () => void;
  hasMessages: boolean;
}

export function TopBar({
  settings,
  onOpenSettings,
  onClearChat,
  hasMessages,
}: TopBarProps) {
  return (
    <header className="sticky top-0 z-30 w-full flex items-center justify-between px-4 sm:px-6 py-3 bg-background/80 backdrop-blur-md border-b border-border/60 transition-colors">
      <div className="flex items-center gap-2">
        <span className="font-semibold tracking-tight text-base text-foreground font-mono">
          π <span className="text-muted text-xs font-sans ml-1">web</span>
        </span>
        <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono bg-surface border border-border text-muted">
          {settings.model}
        </span>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        {hasMessages && (
          <button
            onClick={() => {
              if (confirm('确认清空当前对话？')) {
                onClearChat();
              }
            }}
            className="p-1.5 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
            title="清空会话"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <button
          onClick={onOpenSettings}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted hover:text-foreground hover:bg-surface-hover transition-colors border border-border/50"
          title="设置"
        >
          <SettingsIcon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline text-[11px] font-medium">配置</span>
        </button>
      </div>
    </header>
  );
}
