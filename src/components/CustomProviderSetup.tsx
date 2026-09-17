import { useState } from 'react';
import type { BridgeStatus } from '../types/pi';

/** 与桥接的 SUPPORTED_APIS 保持一致；这几项是 pi 真正支持的 API 类型 */
const API_TYPES = [
  { value: 'openai-completions', label: 'OpenAI Chat Completions（最通用）' },
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
 * pi 的内置目录只覆盖官方供应商，其余靠 models.json 声明：一个 baseUrl、一种
 * API 类型、一组模型 id。模型 id 可以手填，也可以从 `<baseUrl>/models` 拉——
 * 但很多自建服务没实现那个接口，所以拉取失败只是提示，不阻断保存。
 */
export function CustomProviderSetup({
  status,
  onListModels,
  onSave,
  submitLabel = '保存并开始',
}: CustomProviderSetupProps) {
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [api, setApi] = useState(API_TYPES[0].value);
  const [models, setModels] = useState('');
  const [key, setKey] = useState('');
  const [fetchError, setFetchError] = useState<string>();
  const [fetching, setFetching] = useState(false);

  const modelIds = models
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const canSave = id.trim().length > 0 && baseUrl.trim().length > 0 && modelIds.length > 0;

  const pullModels = async () => {
    if (!baseUrl.trim() || fetching) return;

    setFetching(true);
    setFetchError(undefined);
    try {
      const found = await onListModels(baseUrl.trim(), key.trim());
      // 拉回来就覆盖输入框；拉回来是空的也照实反映，免得用户以为已经拉过了
      setModels(found.join('\n'));
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetching(false);
    }
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave) return;

    onSave({
      id: id.trim(),
      label: label.trim(),
      baseUrl: baseUrl.trim(),
      api,
      models: modelIds,
      key: key.trim(),
    });
  };

  const inputClass =
    'w-full rounded-lg border border-border bg-surface px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted';

  return (
    <form onSubmit={submit} className="mt-3 space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <label className="block">
          <span className="text-[11px] text-muted">标识</span>
          <input
            data-field="id"
            value={id}
            onChange={event => setId(event.target.value)}
            placeholder="my-relay"
            autoComplete="off"
            className={`mt-1 font-mono ${inputClass}`}
          />
        </label>
        <label className="block">
          <span className="text-[11px] text-muted">显示名（可选）</span>
          <input
            data-field="label"
            value={label}
            onChange={event => setLabel(event.target.value)}
            placeholder="我的中转站"
            autoComplete="off"
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>

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

      <label className="block">
        <span className="text-[11px] text-muted">API key（可选）</span>
        <input
          data-field="key"
          type="password"
          value={key}
          onChange={event => setKey(event.target.value)}
          placeholder="没有就留空"
          autoComplete="off"
          className={`mt-1 font-mono ${inputClass}`}
        />
      </label>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[11px] text-muted">模型 id（每行一个）</span>
          <button
            type="button"
            onClick={() => void pullModels()}
            disabled={!baseUrl.trim() || fetching}
            className="text-[11.5px] text-muted transition-colors hover:text-foreground disabled:opacity-40"
          >
            {fetching ? '正在拉取…' : '拉取模型列表'}
          </button>
        </div>
        <textarea
          data-field="models"
          value={models}
          onChange={event => setModels(event.target.value)}
          rows={3}
          placeholder={'gpt-x\nclaude-y'}
          className={`mt-1 resize-y font-mono ${inputClass}`}
        />
        {fetchError && (
          <p className="mt-1.5 text-[12px] leading-[1.7] text-amber-600">
            {fetchError}（可以直接手填模型 id）
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSave}
        className="rounded-full bg-accent px-3.5 py-1.5 text-[12px] text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-40"
      >
        {submitLabel}
      </button>

      {status.setupNotice && (
        <p className="text-[12.5px] leading-[1.7] text-rose-500">{status.setupNotice}</p>
      )}
    </form>
  );
}
