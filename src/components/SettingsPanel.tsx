import { useState } from 'react';
import type { BridgeStatus, ModelInfo } from '../types/pi';
import { formatCost, formatTokens } from '../utils/format';
import { X, FolderGit2, PlusCircle, ChevronDown } from 'lucide-react';

interface SettingsPanelProps {
  status: BridgeStatus;
  onClose: () => void;
  onChangeCwd: (cwd: string) => void;
  onNewSession: () => void;
  onSelectModel: (provider: string, modelId: string) => void;
  onSelectThinkingLevel: (level: string) => void;
  onToggleReadOnly: (value: boolean) => void;
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

function modelKey(model: ModelInfo) {
  return `${model.provider}/${model.id}`;
}

function ReadOnlyToggle({
  status,
  onToggle,
}: {
  status: BridgeStatus;
  onToggle: (value: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const on = status.readOnly ?? false;

  const toggle = () => {
    setPending(true);
    onToggle(!on);
    // 桥接重启 pi 大约一秒，回包之后按钮会被真实状态覆盖
    window.setTimeout(() => setPending(false), 3000);
  };

  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-4">
        <span
          className="text-[11px] text-muted"
          title="这不是沙盒。它只是把能改文件、能跑命令的工具从模型手上拿走；真正隔离要把 pi 关进容器或虚拟机。它挡的是「改坏 / 执行」，挡不住「读走」。"
        >
          只读模式
        </span>

        <button
          role="switch"
          aria-checked={on}
          aria-label="只读模式"
          disabled={!status.connected || pending}
          onClick={toggle}
          className={`relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:cursor-default disabled:opacity-50 ${
            on ? 'bg-foreground' : 'bg-border'
          }`}
        >
          <span
            className={`absolute left-[2px] top-[2px] h-3 w-3 rounded-full bg-background transition-transform ${
              on ? 'translate-x-3' : ''
            }`}
          />
        </button>
      </div>

      <p className="mt-1.5 text-[10.5px] leading-[1.6] text-muted">
        agent 只能看，不能改文件、不能跑命令——适合问问题和审代码。
      </p>
    </div>
  );
}

function ModelPicker({
  status,
  onSelectModel,
}: {
  status: BridgeStatus;
  onSelectModel: (provider: string, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const models = status.availableModels ?? [];
  const current = status.model ? modelKey(status.model) : null;
  const selectable = status.connected && models.length > 0;

  return (
    <div className="py-2">
      <button
        onClick={() => selectable && setOpen(o => !o)}
        disabled={!selectable}
        aria-expanded={open}
        className="flex w-full items-baseline justify-between gap-4 text-left disabled:cursor-default"
      >
        <span className="shrink-0 text-[11px] text-muted">模型</span>
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate text-[12.5px] font-mono text-foreground/90">
            {status.model?.name || status.model?.id || '—'}
          </span>
          {selectable && (
            <ChevronDown
              className={`w-3 h-3 shrink-0 text-muted transition-transform duration-200 ${
                open ? 'rotate-180' : ''
              }`}
            />
          )}
        </span>
      </button>

      {open && (
        <div className="mt-1.5 max-h-52 overflow-y-auto rounded-md border border-border/70">
          {models.map(model => {
            const active = modelKey(model) === current;
            return (
              <button
                key={modelKey(model)}
                onClick={() => {
                  if (!active) onSelectModel(model.provider, model.id);
                  setOpen(false);
                }}
                className={`flex w-full items-baseline justify-between gap-3 px-2.5 py-1.5 text-left transition-colors ${
                  active ? 'bg-surface-hover' : 'hover:bg-surface'
                }`}
              >
                <span
                  className={`truncate text-[11.5px] font-mono ${
                    active ? 'text-foreground' : 'text-foreground/80'
                  }`}
                >
                  {model.name || model.id}
                </span>
                <span className="shrink-0 text-[10px] text-muted">
                  {model.provider}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThinkingLevelPicker({
  status,
  onSelectThinkingLevel,
}: {
  status: BridgeStatus;
  onSelectThinkingLevel: (level: string) => void;
}) {
  const levels = status.availableThinkingLevels ?? [];
  const onlyOff = levels.length === 1 && levels[0] === 'off';

  return (
    <div className="py-2">
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        <span className="text-[11px] text-muted">思考强度</span>
        <span className="font-mono text-[11px] text-muted">
          {status.thinkingLevel || '—'}
        </span>
      </div>

      {levels.length === 0 ? (
        <span className="text-[11px] text-muted">—</span>
      ) : (
        <div className="flex flex-wrap gap-1">
          {levels.map(level => {
            const active = level === status.thinkingLevel;
            return (
              <button
                key={level}
                onClick={() => !active && onSelectThinkingLevel(level)}
                disabled={!status.connected}
                title={onlyOff ? '当前模型不支持思考' : undefined}
                className={`rounded px-2 py-1 font-mono text-[10.5px] transition-colors disabled:cursor-default ${
                  active
                    ? 'bg-foreground text-background'
                    : 'bg-surface text-muted hover:text-foreground'
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SettingsPanel({
  status,
  onClose,
  onChangeCwd,
  onNewSession,
  onSelectModel,
  onSelectThinkingLevel,
  onToggleReadOnly,
}: SettingsPanelProps) {
  const [cwdDraft, setCwdDraft] = useState(status.cwd);

  const applyCwd = () => {
    const next = cwdDraft.trim();
    if (next && next !== status.cwd) onChangeCwd(next);
  };

  const stats = status.stats;
  const context = stats?.contextUsage;
  const contextText = context
    ? `${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)} · ${Math.round(context.percent)}%`
    : status.model?.contextWindow
      ? `— / ${formatTokens(status.model.contextWindow)}`
      : '—';

  // 悬停展开 token 明细，并说清楚这是估算而不是供应商账单
  const costTitle = stats
    ? [
        `输入 ${formatTokens(stats.tokens.input)} · 输出 ${formatTokens(stats.tokens.output)}`,
        `缓存读 ${formatTokens(stats.tokens.cacheRead)} · 缓存写 ${formatTokens(stats.tokens.cacheWrite)}`,
        '按 models.json 里的单价估算，与供应商账单可能有出入',
      ].join('\n')
    : undefined;

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

        {/* 运行时信息与可调项 */}
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

            <ModelPicker status={status} onSelectModel={onSelectModel} />

            <Row label="提供方">{status.model?.provider || '—'}</Row>

            <ThinkingLevelPicker
              status={status}
              onSelectThinkingLevel={onSelectThinkingLevel}
            />

            <ReadOnlyToggle status={status} onToggle={onToggleReadOnly} />

            <Row label="本会话花费">
              <span title={costTitle}>{stats ? formatCost(stats.cost) : '—'}</span>
            </Row>

            <Row label="上下文">{contextText}</Row>
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
