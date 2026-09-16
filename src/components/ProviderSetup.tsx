import { useState } from 'react';
import type { BridgeStatus } from '../types/pi';

interface ProviderSetupProps {
  status: BridgeStatus;
  /** 保存供应商凭证；具体落盘由桥接完成 */
  onSave: (provider: string, key: string) => void;
}

/**
 * 配置模型凭证。
 *
 * 这一步桥接能做（直接写 auth.json），但**订阅登录做不了**——`/login` 是纯 TUI
 * 交互流程。所以两种方式都摆出来：贴 API key 是本页的事，订阅登录只做引导，
 * 并说明授权完成后页面会自己继续（外层每 5 秒重探一次）。
 */
export function ProviderSetup({ status, onSave }: ProviderSetupProps) {
  const providers = status.providers ?? [];
  const subscriptions = status.subscriptions ?? [];
  const [selected, setSelected] = useState('');
  const [key, setKey] = useState('');

  // providers 是异步到达的，所以这里兜底到第一项，而不是在 useState 初始值里定
  const provider = selected || providers[0]?.id || '';
  const canSubmit = Boolean(provider) && key.trim().length > 0;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSave(provider, key.trim());
  };

  return (
    <section className="mt-6">
      <h2 className="text-[12px] text-muted">配置模型</h2>

      <form onSubmit={submit} className="mt-2 space-y-2.5">
        <label className="block">
          <span className="sr-only">供应商</span>
          <select
            value={provider}
            onChange={event => setSelected(event.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] text-foreground"
          >
            {providers.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="sr-only">API key</span>
          <input
            type="password"
            value={key}
            onChange={event => setKey(event.target.value)}
            placeholder="粘贴 API key"
            autoComplete="off"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-[12.5px] text-foreground placeholder:text-muted"
          />
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-full bg-accent px-3.5 py-1.5 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
        >
          保存并开始
        </button>

        {status.setupNotice && (
          <p className="text-[12.5px] leading-[1.7] text-rose-500">{status.setupNotice}</p>
        )}
      </form>

      {subscriptions.length > 0 && (
        <details className="mt-5 rounded-lg border border-border bg-surface px-3.5 py-3">
          <summary className="cursor-pointer text-[12px] text-foreground/90">
            或者用订阅账号登录
          </summary>
          <p className="mt-2 text-[12px] leading-[1.7] text-muted">
            订阅登录需要在终端里完成：先运行 <code className="font-mono">pi</code>，再输入{' '}
            <code className="font-mono">/login</code>，选择下面任意一个并完成授权：
          </p>
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-foreground/80">
            {subscriptions.map(entry => (
              <li key={entry.id}>{entry.label}</li>
            ))}
          </ul>
          <p className="mt-2 text-[12px] leading-[1.7] text-muted">
            授权完成后这里会自动继续，不用回来再点一次。
          </p>
        </details>
      )}
    </section>
  );
}
