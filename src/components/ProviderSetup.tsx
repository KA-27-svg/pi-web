import { useEffect, useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import { useRefreshFeedback } from '../hooks/useRefreshFeedback';

interface ProviderSetupProps {
  status: BridgeStatus;
  /**
   * 保存供应商入口。
   * baseUrl 留空 = 配 / 改官方入口；填了 = 保存成一个**独立的中转端点**
   * （新的供应商 id，不动官方条目）。
   */
  onSave: (provider: string, key: string, baseUrl?: string, name?: string) => void;
  /**
   * wizard：首次运行向导里用，自带「配置模型」标题，按钮说「保存并开始」
   * settings：设置面板里用，外面已经有分区标题了（而且不是「开始」什么），
   *           所以不要标题、按钮只说「保存」
   */
  variant?: 'wizard' | 'settings';
  /** 存好了。弹窗用它把自己关掉，外面再报一声成功 */
  onSaved?: () => void;
}

/**
 * 配置模型凭证。供应商、密钥、名称、地址。
 *
 * 入口有两种，存的位置也不同：
 * - **官方入口**：`auth.json` 里的内置 id（如 deepseek），不带地址，
 *   模型清单来自 pi 的内置目录。
 * - **中转端点**：填了地址就另存一个 id（如 deepseek-relay），自己的密钥 + 地址，
 *   模型清单从内置目录复制。以前地址是写进官方那一条的，结果配完中转官方入口
 *   就被覆盖没了——同一个上游想同时用官方和中转根本做不到。
 *
 * 已配的中转端点也会出现在供应商下拉里（选中后改名 / 换密钥 / 换地址）。
 *
 * 订阅登录（Claude Pro / ChatGPT / Copilot）桥接做不了——`/login` 是纯 TUI 流程，
 * 所以只做引导，并说明授权完成后页面会自己继续。
 */
export function ProviderSetup({
  status,
  onSave,
  variant = 'wizard',
  onSaved,
}: ProviderSetupProps) {
  const wizard = variant === 'wizard';
  const submitLabel = wizard ? '保存并开始' : '保存';
  // 只收能贴 API key 的供应商：subscriptionOnly 的（如 GitHub Copilot）只认 OAuth，
  // 给它写一个 { type: 'api_key' } 进 auth.json 语义就是错的
  const presets = (status.providers ?? []).filter(preset => !preset.subscriptionOnly);
  const presetIds = new Set(presets.map(preset => preset.id));
  /** 已配的中转端点：不在内置目录里的已配 id（显示名优先） */
  const endpoints = (status.setup?.credentials.providers ?? [])
    .filter(id => !presetIds.has(id))
    .map(id => ({ id, label: status.providerNames?.[id] ?? id }));
  const providers = [...presets, ...endpoints];
  const subscriptions = status.subscriptions ?? [];

  const [selected, setSelected] = useState('');
  const [key, setKey] = useState('');
  const [baseUrlDraft, setBaseUrlDraft] = useState<Record<string, string>>({});
  /** 用户改过的名字。没改的供应商就用它已有那个 */
  const [nameDraft, setNameDraft] = useState<Record<string, string>>({});

  // providers 是异步到达的，所以这里兜底到第一项，而不是在 useState 初始值里定
  const provider = selected || providers[0]?.id || '';
  const savedName = status.providerNames?.[provider] ?? '';
  // 切供应商时跟着换成那一个已有的名字；用户打过字就以他打过的为准
  const name = nameDraft[provider] ?? savedName;
  // 已经配过凭证的供应商可以留空密钥：只改名字/地址，不必把不回显的密钥重贴一遍
  const alreadyConfigured = (status.setup?.credentials.providers ?? []).includes(provider);
  // 地址也要回显：不给的话，用户只换 key 会在空地址上提交，把中转地址覆盖掉
  const savedBaseUrl = status.providerBaseUrls?.[provider] ?? '';
  const baseUrl = baseUrlDraft[provider] ?? savedBaseUrl;
  const canSubmit = Boolean(provider) && (key.trim().length > 0 || alreadyConfigured);

  // 保存结果由桥接广播回来（provider_saved → setup_status），拿 setup 的引用变化
  // 当完成信号；不然点一下「保存」什么都不变，用户不知道到底存上没
  const save = useRefreshFeedback(status.setup);

  // 存好了才通知外面——按钮上那句「已保存」在弹窗里一闪就没了，
  // 外面那条提示才是用户真正会看到的
  useEffect(() => {
    if (save.phase === 'done') onSaved?.();
  }, [save.phase, onSaved]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    save.trigger(() =>
      onSave(provider, key.trim(), baseUrl.trim() || undefined, name.trim() || undefined)
    );
  };

  const inputClass =
    'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted';

  return (
    <section className={wizard ? 'mt-6' : ''}>
      {wizard && <h2 className="text-[12px] text-muted">配置模型</h2>}

      <form onSubmit={submit} className="mt-2 space-y-2.5">
        <label className="block">
          <span className="text-[11px] text-muted">供应商</span>
          <select
            value={provider}
            onChange={event => {
              setSelected(event.target.value);
              // 密钥是单个输入框、又不回显；换供应商时必须清掉，
              // 否则容易把 A 刚贴的 key 存到 B 名下
              setKey('');
            }}
            className={`mt-1 ${inputClass}`}
          >
            <optgroup label="官方入口">
              {presets.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </optgroup>
            {endpoints.length > 0 && (
              <optgroup label="已配的中转端点">
                {endpoints.map(endpoint => (
                  <option key={endpoint.id} value={endpoint.id}>
                    {endpoint.label}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        <label className="block">
          <span className="text-[11px] text-muted">API 密钥</span>
          <input
            type="password"
            value={key}
            onChange={event => setKey(event.target.value)}
            placeholder={alreadyConfigured ? '留空则不改动已有密钥' : 'sk-...'}
            autoComplete="off"
            className={`mt-1 font-mono ${inputClass}`}
          />
          {alreadyConfigured && (
            <span className="mt-1 block text-[10.5px] leading-[1.6] text-muted/80">
              这个供应商已经配过，留空密钥就只更新下面的名称 / 地址。
            </span>
          )}
        </label>

        <label className="block">
          <span className="text-[11px] text-muted">名称</span>
          <input
            data-field="name"
            value={name}
            onChange={event =>
              setNameDraft(draft => ({ ...draft, [provider]: event.target.value }))
            }
            placeholder="留空用官方名字；配中转时建议起个名字（如「官方 / 中转」）"
            autoComplete="off"
            className={`mt-1 ${inputClass}`}
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-muted">中转地址（可选）</span>
          <input
            data-field="baseUrl"
            value={baseUrl}
            onChange={event =>
              setBaseUrlDraft(draft => ({ ...draft, [provider]: event.target.value }))
            }
            placeholder="https://你的中转站/v1"
            autoComplete="off"
            className={`mt-1 font-mono ${inputClass}`}
          />
          {baseUrl.trim() ? (
            <span className="mt-1 block text-[10.5px] leading-[1.6] text-muted/80">
              会保存成一个**独立的中转端点**（用上面的名称区分），官方入口不受影响，
              两个都能用。官方条目上残留的旧地址会被自动清掉。
              保存后 pi 会重启一次来加载新的模型清单（正在跑的那一轮会被打断）。
            </span>
          ) : (
            <span className="mt-1 block text-[10.5px] leading-[1.6] text-muted/80">
              走中转站才填。留空就是官方入口。
            </span>
          )}
        </label>

        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-full bg-accent px-3.5 py-1.5 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
        >
          {save.phase === 'done' ? '已保存' : submitLabel}
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
