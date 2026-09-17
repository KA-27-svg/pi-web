import { useState } from 'react';
import type { BridgeStatus } from '../types/pi';
import { deriveProviderId } from '../utils/customProvider';

/** 与桥接的 SUPPORTED_APIS 保持一致；这几项是 pi 真正支持的 API 类型 */
const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI 兼容（最通用）' },
  { value: 'openai-responses', label: 'OpenAI Responses' },
  { value: 'anthropic-messages', label: 'Anthropic Messages' },
  { value: 'google-generative-ai', label: 'Google Generative AI' },
];

export interface CustomProviderDraft {
  id: string;
  label: string;
  baseUrl: string;
  api: string;
  models: string[];
  key: string;
}

interface CustomProviderSetupProps {
  status: BridgeStatus;
  /** 从 <baseUrl>/models 拉模型列表；失败请抛错，这里会把原因显示出来 */
  onListModels: (baseUrl: string, key: string) => Promise<string[]>;
  onSave: (draft: CustomProviderDraft) => void;
  /** 按钮文案。向导里说「保存并开始」，设置面板里只是「保存」 */
  submitLabel?: string;
}

/**
 * 自定义端点（中转站 / 自建服务）。
 *
 * 平时只有三样：显示名、API 地址、API 密钥。其余都替用户决定了：
 *
 * - **标识**从地址的域名推（`https://relay.example/v1` → `relay.example`）。
 *   它必须是 ASCII（桥接限成 `^[A-Za-z0-9][A-Za-z0-9._-]*$`），而显示名多半是中文，
 *   推不出来，所以只能从域名来。不暴露给用户。
 * - **API 类型**默认 openai-completions，中转站基本都是这个。
 * - **模型列表**保存时自动从 `<baseUrl>/models` 拉。
 *
 * 密钥是**必填**的。pi 的文档写得很直白：没配鉴权时模型会加载，但「在 `/model` 和
 * `--list-models` 里始终不可用」——留空等于存了一个选不了的供应商。本地服务
 * （Ollama / LM Studio）不需要真的 key，但也得填一个占位的。
 *
 * ## 自动拉不到的时候
 *
 * pi 的 models.json 靠 `models` 声明这个供应商有哪些模型，它自己不会去 `/models`
 * 发现（那个接口是给我们 UI 省事的）。所以拉不到时还是得让用户手填——这时**就地**把
 * API 类型和模型 id 摊出来，而不是塞进一个要他先找到的折叠区。
 *
 * 这两项放一起还有个道理：需要改 API 类型的，基本就是自动拉不到的那批端点
 * （不是 OpenAI 格式的，`/v1/models` 多半也不按这个来）。本来就该一起出现。
 */
export function CustomProviderSetup({
  status,
  onListModels,
  onSave,
  submitLabel = '保存并开始',
}: CustomProviderSetupProps) {
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');

  const [api, setApi] = useState(API_TYPES[0].value);
  const [models, setModels] = useState('');

  /** 自动拉失败过就把手动那两块摊出来，之后一直留着 */
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const manualModels = models
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const canSubmit =
    Boolean(label.trim()) && Boolean(baseUrl.trim()) && Boolean(key.trim()) && !busy;

  const commit = (modelIds: string[]) => {
    onSave({
      id: deriveProviderId(baseUrl),
      label: label.trim(),
      baseUrl: baseUrl.trim(),
      api,
      models: modelIds,
      key: key.trim(),
    });
  };

  const pullModels = async (): Promise<string[]> => {
    const found = await onListModels(baseUrl.trim(), key.trim());
    setModels(found.join('\n'));
    return found;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;

    // 手填过就用手的，不再去打扰网络
    if (manualModels.length > 0) {
      commit(manualModels);
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      const found = await pullModels();
      if (found.length === 0) {
        // 拉到了但是空的，不能当成功：pi 那边一个模型都没有，选了也是空的
        setManual(true);
        setError('这个地址没返回任何模型，下面手填一下模型 id');
        return;
      }
      commit(found);
    } catch (err) {
      setManual(true);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pullButton = async () => {
    if (!baseUrl.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await pullModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted';

  return (
    <form onSubmit={submit} className="mt-3 space-y-2.5">
      <label className="block">
        <span className="text-[11px] text-muted">显示名</span>
        <input
          data-field="label"
          value={label}
          onChange={event => setLabel(event.target.value)}
          placeholder="我的中转站"
          autoComplete="off"
          className={`mt-1 ${inputClass}`}
        />
      </label>

      <label className="block">
        <span className="text-[11px] text-muted">API 地址</span>
        <input
          data-field="baseUrl"
          value={baseUrl}
          onChange={event => setBaseUrl(event.target.value)}
          placeholder="https://relay.example/v1"
          autoComplete="off"
          className={`mt-1 font-mono ${inputClass}`}
        />
      </label>

      <label className="block">
        <span className="text-[11px] text-muted">
          API 密钥
          <span className="ml-1.5 text-muted/70">本地服务随便填一个，例如 ollama</span>
        </span>
        <input
          data-field="key"
          type="password"
          value={key}
          onChange={event => setKey(event.target.value)}
          placeholder="sk-..."
          autoComplete="off"
          className={`mt-1 font-mono ${inputClass}`}
        />
      </label>

      {/* 只有自动拉失败时才出现，平时不占位置也不占注意力 */}
      {manual && (
        <div className="space-y-2.5 rounded-lg border border-border/70 px-3 py-2.5">
          <label className="block">
            <span className="text-[11px] text-muted">API 类型</span>
            <select
              data-field="api"
              value={api}
              onChange={event => setApi(event.target.value)}
              className={`mt-1 ${inputClass}`}
            >
              {API_TYPES.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[11px] text-muted">模型 id</span>
              <button
                type="button"
                onClick={() => void pullButton()}
                disabled={!baseUrl.trim() || busy}
                className="shrink-0 text-[11.5px] text-muted transition-colors hover:text-foreground disabled:opacity-40"
              >
                {busy ? '正在拉取…' : '再试一次'}
              </button>
            </div>
            <textarea
              data-field="models"
              value={models}
              onChange={event => setModels(event.target.value)}
              rows={3}
              placeholder={'每行一个，例如\ngpt-x\nclaude-y'}
              className={`mt-1 resize-y font-mono ${inputClass}`}
            />
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!canSubmit}
        className="rounded-full bg-accent px-3.5 py-1.5 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
      >
        {busy ? '正在拉取模型…' : submitLabel}
      </button>

      {error && <p className="text-[12px] leading-[1.7] text-amber-600">{error}</p>}

      {status.setupNotice && (
        <p className="text-[12.5px] leading-[1.7] text-rose-500">{status.setupNotice}</p>
      )}
    </form>
  );
}
