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


/**
 * 端点 id → 它的上游（内置目录里的 id）。
 *
 * 端点 id 是我们自己生成的（`<上游>-relay`、撞了 `-2`），所以能反推回去。
 * 编辑一个已配端点时靠它知道该拿谁的内置目录当兜底。
 *
 * 除了我们自己的命名，也认「上游名作为一个词出现在 id 里」：手写的 id
 * （`micuapi-deepseek`、`micuapi-glm`）没有 `-relay` 后缀，但一样能认出来。
 * 认不出来返回 null（调用方不要瞎猜，改成不预勾）。
 */
export function upstreamOf(
  providerId: string,
  presetIds: Iterable<string>
): string | null {
  const id = providerId.trim().toLowerCase();
  if (!id) return null;

  const presets = [...presetIds].map(preset => preset.trim().toLowerCase()).filter(Boolean);
  // 长的先试：同时含 `glm` 和 `glm-4` 这种命名时不至于认成短的那个
  presets.sort((a, b) => b.length - a.length);

  for (const preset of presets) {
    if (id === preset || id.startsWith(`${preset}-relay`)) return preset;
  }

  const segments = id.split(/[^a-z0-9]+/);
  for (const preset of presets) {
    if (segments.includes(preset)) return preset;
  }
  return null;
}

/**
 * 上游报的这个模型 id 算不算「这个供应商自己的」。
 *
 * 中转分组常常是混合的：真实案例里一个 DeepSeek 分组同时卖 glm-5.3、kimi-k3、
 * qwen3.8-max。按名字判断是唯一可行的办法（上游只报 id，不报厂商）。
 * 两种命中方式：
 *  - 前缀：`deepseek-v4-flash`、`deepseek-ai/DeepSeek-V3`（SiliconFlow 那种写法）
 *  - 按非字母数字切段后正好是上游名：`moonshot/kimi-k3` 里的 `kimi`
 */
/**
 * 这个上游名下「派生出来的」端点 id：`<上游>-relay`、`<上游>-relay-2`……
 *
 * 不含官方条目本身（`deepseek`）——那是官方入口，不是端点。
 * 用来回答「这个上游是不是已经有一个指向某地址的端点了」。
 */
export function derivedEndpointIds(provider: string, ids: Iterable<string>): string[] {
  const prefix = `${provider.trim()}-relay`;
  return [...ids].filter(id => id === prefix || id.startsWith(`${prefix}-`));
}

/**
 * 两个中转地址是不是同一个。
 *
 * 用户重配时地址常常是复制粘贴的，尾斜杠 / 大小写 / 空格会不一样；
 * 这直接决定「是改已有端点还是再建一个」，所以比较前统一归一化。
 * 不做路径改写（`/v1` 与 `/1` 是**不同**的地址，一个能用一个是假 200）。
 */
export function sameEndpointUrl(a: unknown, b: unknown): boolean {
  const norm = (value: unknown) =>
    typeof value === 'string' ? value.trim().replace(/\/+$/, '').toLowerCase() : '';
  const left = norm(a);
  return Boolean(left) && left === norm(b);
}

export function matchesUpstream(modelId: string, upstream: string): boolean {
  const id = modelId.trim().toLowerCase();
  const up = upstream.trim().toLowerCase();
  if (!id || !up) return false;
  if (id.startsWith(up)) return true;
  return id.split(/[^a-z0-9]+/).includes(up);
}

/**
 * 上游报的清单里，哪些默认勾选。
 *
 * 两条命中任一即可：**内置目录里有同名的**（说明官方就是这个模型，元数据还更全），
 * 或**名字像是这个上游的**。剩下的（别的厂商的模型）列出来但不勾——
 * 想要的人自己勾，不想要的人不必每次在一堆无关模型里找。
 */
export function recommendedModelIds(
  upstream: string,
  upstreamIds: Iterable<string>,
  catalogIds: Iterable<string>
): string[] {
  const catalog = new Set(catalogIds);
  return [...upstreamIds].filter(
    id => catalog.has(id) || matchesUpstream(id, upstream)
  );
}

/**
 * 勾中的 id → 写进 models.json 的模型定义。
 *
 * 内置目录里**有**同名定义的就用目录那份：它带着 cost / contextWindow / reasoning /
 * compat，界面上显示的是官方名、上下文窗口也对，比上游那句光秃秃的 id 好得多。
 * 目录里没有的（中转独有的模型）才退回最小定义——`GET /models` 是 [OI] 风格接口，
 * 能列出模型的基本都是这一族，所以 api 默认 `openai-completions`。
 *
 * 注意：目录那份的 baseUrl 已经在 catalogModelsFor 里剥掉了，这里不必再管。
 */
export function mergeModelDefinitions(
  ids: Iterable<string>,
  catalogModels: Record<string, unknown>[]
): Record<string, unknown>[] {
  const byId = new Map(
    catalogModels
      .filter(model => typeof model?.id === 'string')
      .map(model => [model.id as string, model])
  );

  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const raw of ids) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    merged.push(byId.get(id) ?? { id, name: id, api: 'openai-completions' });
  }
  return merged;
}
