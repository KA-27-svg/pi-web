import { PROVIDER_PRESETS } from './providers.js';

/**
 * 「同一上游的多个入口」。
 *
 * 起因是一个真实的配置问题：官方 DeepSeek 配好后，再配一个中转的 DeepSeek，
 * 结果只剩一个能用——因为凭证按供应商 id 单键存储（auth.json 里 `deepseek` 只有一条），
 * 中转地址写进同一条，等于把官方入口覆盖掉了。而模型清单来自 pi 的内置目录，
 * 界面上看起来还是「官方 DeepSeek」，实际上请求全去了中转。
 *
 * 解法：中转保存成一个**独立端点**——新的供应商 id（`deepseek-relay` 这种），
 * 自己的密钥 + 自己的地址，模型清单从 pi 的内置目录**原样复制**（剥掉 baseUrl，
 * 让 provider 级的中转地址生效）。官方条目一个字节不动，两个入口并存。
 *
 * 之所以要复制目录：models.json 里一个目录里没有的 id，若不写 models 就一个模型
 * 都没有（provider-composer 的 applyModelsJson 对未知 id 的 baseModels 是空数组），
 * 在界面上不可见。
 */

/** 内置目录里有的 id。这些是「官方入口」，中转要另起 id */
export function isPresetProvider(providerId: string): boolean {
  return PROVIDER_PRESETS.some(preset => preset.id === providerId);
}

/** 官方名字，给「默认叫 DeepSeek 中转」这种兜底用 */
export function presetLabel(providerId: string): string | undefined {
  return PROVIDER_PRESETS.find(preset => preset.id === providerId)?.label;
}

/**
 * 从 pi 的模型清单里摘出某个上游的定义，准备写进 models.json。
 *
 * **必须剥掉 baseUrl / provider / headers**：definition.baseUrl 的优先级高于
 * provider 级的中转地址，原样复制会让请求仍发往官方。
 */
export function catalogModelsFor(
  models: unknown,
  providerId: string
): Record<string, unknown>[] {
  if (!Array.isArray(models)) return [];

  const copyable = new Set([
    'id',
    'name',
    'api',
    'reasoning',
    'input',
    'cost',
    'contextWindow',
    'maxTokens',
    'samplingParams',
    'compat',
    'thinkingLevelMap',
  ]);

  return models
    .filter(
      (model: any) =>
        model && typeof model === 'object' && (model as any).provider === providerId
    )
    .map((model: any) =>
      Object.fromEntries(
        Object.entries(model).filter(([key]) => copyable.has(key))
      )
    );
}

/** 端点 id：`<上游>-relay`，撞了就 `-2`、`-3` 往后排 */
export function deriveEndpointId(
  provider: string,
  taken: Iterable<string>
): string {
  const existing = new Set(taken);
  const base = `${provider}-relay`;
  if (!existing.has(base)) return base;

  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  throw new Error(`「${provider}」的中转端点太多了，请先删掉一些`);
}

/** models.json 里的模型定义要能通过 pi 的校验：至少得有 id */
export function assertModelsUsable(models: Record<string, unknown>[]): void {
  if (models.length === 0) {
    throw new Error('pi 的内置目录里没有这个供应商的模型清单，无法创建独立端点');
  }
  const bad = models.find(model => typeof model.id !== 'string' || !model.id);
  if (bad) throw new Error('模型清单里有缺 id 的条目，无法创建独立端点');
}

/** OpenAI 风格模型列表响应（`GET {baseUrl}/models`）里的一条 */
export function modelIdFromListEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null;
  const id = (entry as { id?: unknown }).id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

/**
 * 上游自己报的模型清单 → 模型定义。
 *
 * 中转分组卖的模型名经常和官方不一样（这个真实案例里上游是 deepseek-v4-flash，
 * 而内置目录是 deepseek-chat）——复制内置目录在这种站上会 model_not_found。
 * 所以优先用上游 `/models` 报的清单：名字用 id，api 默认 openai-completions
 * （`GET /models` 是 OpenAI 风格接口，能列出模型的基本都是这一族），
 * contextWindow / cost 未知就让 pi 用默认值。
 */
export function upstreamModels(payload: unknown): Record<string, unknown>[] {
  const list = Array.isArray((payload as { data?: unknown })?.data)
    ? ((payload as { data: unknown[] }).data)
    : Array.isArray(payload)
      ? (payload as unknown[])
      : [];

  const ids = list.map(modelIdFromListEntry).filter((id): id is string => !!id);
  return [...new Set(ids)].map(id => ({ id, name: id, api: 'openai-completions' }));
}
