import { useState } from 'react';
import type { BridgeStatus, ModelInfo } from '../types/pi';
import { formatCost, formatTokens } from '../utils/format';
import { providerLabel } from '../utils/providerLabel';
import { useRefreshFeedback } from '../hooks/useRefreshFeedback';
import { X, ChevronDown, RefreshCw } from 'lucide-react';

interface SettingsPanelProps {
  status: BridgeStatus;
  onClose: () => void;
  onSelectModel: (provider: string, modelId: string) => void;
  onSelectThinkingLevel: (level: string) => void;
  /** 重新探测环境（自检区用） */
  onRecheckSetup: () => void;
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
  // 这里用 id 而不是显示名：它是身份标识，用户起的名字可能重名
  return `${model.provider}/${model.id}`;
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
                  {providerLabel(status, model.provider)}
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
  onSelectModel,
  onSelectThinkingLevel,
  onRecheckSetup,
}: SettingsPanelProps) {
  const stats = status.stats;
  const setup = status.setup;
  // 重新检测是跑 node / npm / pi 几条命令再回来，得等一两秒——不报状态的话
  // 用户点完只看到同一幅画面，会以为没点上
  const recheck = useRefreshFeedback(setup);
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

      <div className="absolute right-4 top-14 z-50 max-h-[calc(100vh-5rem)] w-[19rem] origin-top-right overflow-y-auto rounded-xl border border-border bg-background shadow-[0_4px_24px_-8px_rgba(0,0,0,0.12)] paper-in">
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

            <Row label="提供方">
              {status.model ? providerLabel(status, status.model.provider) : '—'}
            </Row>

            <ThinkingLevelPicker
              status={status}
              onSelectThinkingLevel={onSelectThinkingLevel}
            />

            <Row label="本会话花费">
              <span title={costTitle}>{stats ? formatCost(stats.cost) : '—'}</span>
            </Row>

            <Row label="上下文">{contextText}</Row>
          </div>
        </div>

        {/* 环境自检：出问题时先看这里，比让用户自己猜快得多 */}
        {setup && (
          <div className="border-t border-border px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted">环境自检</span>
              <button
                onClick={() => recheck.trigger(onRecheckSetup)}
                disabled={recheck.phase === 'pending'}
                className="flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-foreground disabled:cursor-default"
              >
                <RefreshCw
                  className={`w-3 h-3 ${recheck.phase === 'pending' ? 'animate-spin' : ''} ${
                    recheck.phase === 'done' ? 'text-emerald-600' : ''
                  }`}
                />
                {recheck.phase === 'pending' ? '检测中…' : recheck.phase === 'done' ? '已刷新' : '重新检测'}
              </button>
            </div>

            <div className="divide-y divide-border/70">
              <Row label="Node">
                {setup.node.version ?? '未找到'}
                {!setup.node.ok && <span className="text-amber-600"> · 需要 ≥ {setup.node.minimum}</span>}
              </Row>
              <Row label="pi">{setup.pi.version ?? '未安装'}</Row>
              {setup.gitBash.required && (
                <Row label="Git Bash">
                  {/* 找不到 bash 时桥接会把 pi 的工具集换成 PowerShell，实际照样能跑命令。
                      只说「未找到」会让人以为这台机器跑不了命令 */}
                  {setup.gitBash.available
                    ? (setup.gitBash.path ?? '已找到')
                    : setup.gitBash.mode === 'powershell'
                      ? '未找到，pi 改用 PowerShell'
                      : '未找到'}
                </Row>
              )}
            </div>

            {/*
              说清楚边界：这里只查本机配置。真能不能连上模型，
              得发一条消息（会产生真实调用与费用）才知道，不适合自动跑。
            */}
            <p className="mt-2 text-[10.5px] leading-[1.6] text-muted/80">
              只检查本机配置，不测网络连通性。
            </p>
          </div>
        )}
      </div>
    </>
  );
}
