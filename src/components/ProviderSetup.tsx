import { useEffect, useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import { useRefreshFeedback } from '../hooks/useRefreshFeedback';

interface ProviderSetupProps {
  status: BridgeStatus;
  /** 保存供应商凭证；baseUrl 只在走中转站时才填，name 留空表示用官方名字 */
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
 * 配置模型凭证。就三样：供应商、密钥、地址（走中转站才改）。
 *
 * 这是照着 pi 自己的做法来的：
 *
 * - **供应商**取内置目录（20 个），密钥写进 `auth.json` 的 `{ type: 'api_key', key }`。
 * - **地址**是可选的 `baseUrl`。填了它，pi 就仍然用**内置的那套模型清单**，只是把请求
 *   发到你指定的地址——即中转站 / 自建网关。pi 的文档叫它
 *   「Route a built-in provider through a proxy without redefining models」，
 *   我们桥接的 `save_provider_key` 本来就收 baseUrl，凭证解析也认这个字段。
 *
 * 所以不需要声明「有哪些模型」、也不需要选 API 类型：模型清单一律来自 pi 内置目录，
 * 中转站的分组只决定其中哪些真的能用。
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
  const providers = (status.providers ?? []).filter(preset => !preset.subscriptionOnly);
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
            {providers.map(preset => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
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
            placeholder="留空就用官方名字"
            autoComplete="off"
            className={`mt-1 ${inputClass}`}
          />
        </label>

        <label className="block">
          <span className="text-[11px] text-muted">地址</span>
          <input
            data-field="baseUrl"
            value={baseUrl}
            onChange={event =>
              setBaseUrlDraft(draft => ({ ...draft, [provider]: event.target.value }))
            }
            placeholder="仅中转填写"
            autoComplete="off"
            className={`mt-1 font-mono ${inputClass}`}
          />
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
