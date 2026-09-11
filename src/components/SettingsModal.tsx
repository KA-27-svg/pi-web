import type { Settings } from '../types';
import { X, RotateCcw, Check } from 'lucide-react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => void;
  onReset: () => void;
  onClearChat: () => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onUpdate,
  onReset,
  onClearChat,
}: SettingsModalProps) {

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs transition-opacity">
      <div className="w-full max-w-md bg-surface border border-border rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* 头部 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">API 与模型设置</h3>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-muted hover:text-foreground hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 表单内容 */}
        <div className="p-5 space-y-4 text-xs">
          <div>
            <label className="block font-medium text-foreground mb-1.5">
              API Base URL
            </label>
            <input
              type="text"
              value={settings.baseUrl}
              onChange={e => onUpdate({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com/v1 或 http://localhost:11434/v1"
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent"
            />
            <p className="text-[11px] text-muted mt-1">
              兼容 Ollama, LM Studio, DeepSeek 或 OpenAI 格式
            </p>
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1.5">
              API Key (本地模型可留空)
            </label>
            <input
              type="password"
              value={settings.apiKey}
              onChange={e => onUpdate({ apiKey: e.target.value })}
              placeholder="sk-..."
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent font-mono"
            />
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1.5">
              Model 模型名称
            </label>
            <input
              type="text"
              value={settings.model}
              onChange={e => onUpdate({ model: e.target.value })}
              placeholder="例如 deepseek-r1, llama3, gpt-4o-mini"
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent font-mono"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="font-medium text-foreground">
                Temperature (随机性: {settings.temperature})
              </label>
            </div>
            <input
              type="range"
              min="0"
              max="1.5"
              step="0.1"
              value={settings.temperature}
              onChange={e => onUpdate({ temperature: parseFloat(e.target.value) })}
              className="w-full accent-accent cursor-pointer"
            />
          </div>

          <div>
            <label className="block font-medium text-foreground mb-1.5">
              System Prompt (系统提示词)
            </label>
            <textarea
              rows={2}
              value={settings.systemPrompt}
              onChange={e => onUpdate({ systemPrompt: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-background border border-border text-foreground placeholder:text-muted/60 focus:outline-none focus:border-accent resize-none leading-relaxed"
            />
          </div>

          <div className="pt-2 border-t border-border flex items-center justify-between">
            <button
              onClick={() => {
                if (confirm('确认清空所有对话记录？')) {
                  onClearChat();
                  onClose();
                }
              }}
              className="text-rose-500 hover:text-rose-600 font-medium py-1 text-[11px]"
            >
              清空会话记录
            </button>

            <button
              onClick={onReset}
              className="flex items-center gap-1 text-muted hover:text-foreground text-[11px]"
            >
              <RotateCcw className="w-3 h-3" />
              恢复默认
            </button>
          </div>
        </div>

        {/* 底部完成按钮 */}
        <div className="px-5 py-3 bg-surface-hover/50 border-t border-border flex justify-end">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-medium hover:bg-accent-hover transition-colors"
          >
            <Check className="w-3.5 h-3.5" />
            完成
          </button>
        </div>
      </div>
    </div>
  );
}
