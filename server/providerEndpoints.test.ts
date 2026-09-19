import { describe, expect, it } from 'vitest';
import {
  assertModelsUsable,
  catalogModelsFor,
  deriveEndpointId,
  isPresetProvider,
  derivedEndpointIds,
  mergeModelDefinitions,
  presetLabel,
  recommendedModelIds,
  sameEndpointUrl,
  upstreamOf,
} from './providerEndpoints';

/** pi 的 get_available_models 回包里，一条模型定义长这样 */
const catalogModel = (over: Record<string, unknown> = {}) => ({
  id: 'deepseek-chat',
  name: 'DeepSeek Chat',
  api: 'openai-completions',
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 65536,
  maxTokens: 8192,
  compat: { supportsStrictMode: true },
  ...over,
});

describe('端点 id 与命名', () => {
  it('内置目录里的才算官方入口', () => {
    expect(isPresetProvider('deepseek')).toBe(true);
    expect(isPresetProvider('deepseek-relay')).toBe(false);
  });

  it('默认端点 id 是 <上游>-relay', () => {
    expect(deriveEndpointId('deepseek', ['deepseek'])).toBe('deepseek-relay');
  });

  it('撞了就往后排，不会覆盖已有端点', () => {
    expect(deriveEndpointId('deepseek', ['deepseek', 'deepseek-relay'])).toBe('deepseek-relay-2');
    expect(deriveEndpointId('deepseek', ['deepseek', 'deepseek-relay', 'deepseek-relay-2'])).toBe(
      'deepseek-relay-3'
    );
  });

  it('官方名用来兜底「DeepSeek 中转」这种默认显示名', () => {
    expect(presetLabel('deepseek')).toBe('DeepSeek');
    expect(presetLabel('deepseek-relay')).toBeUndefined();
  });
});

describe('从内置目录复制模型定义', () => {
  it('只留这个上游的，并且剥掉 baseUrl / provider（否则中转地址会被定义里的盖掉）', () => {
    const models = [
      catalogModel(),
      catalogModel({ id: 'deepseek-reasoner', provider: 'deepseek' }),
      catalogModel({ id: 'gpt-4', provider: 'openai' }),
    ];

    const copied = catalogModelsFor(models, 'deepseek');

    expect(copied).toHaveLength(2);
    for (const model of copied) {
      expect(model.baseUrl).toBeUndefined();
      expect(model.provider).toBeUndefined();
      expect(model.headers).toBeUndefined();
    }
    // 该留的都在
    expect(copied[0]).toMatchObject({
      id: 'deepseek-chat',
      api: 'openai-completions',
      contextWindow: 65536,
      cost: { input: 1 },
    });
  });

  it('回包不是数组时给空，由上层报可读的错误', () => {
    expect(catalogModelsFor(undefined, 'deepseek')).toEqual([]);
    expect(catalogModelsFor('nope', 'deepseek')).toEqual([]);
  });
});

describe('清单可用性检查', () => {
  it('空清单拒绝（否则端点建出来一个模型都没有，界面上看不见）', () => {
    expect(() => assertModelsUsable([])).toThrow(/内置目录/);
  });

  it('缺 id 的条目拒绝', () => {
    expect(() => assertModelsUsable([{ name: 'x' }])).toThrow(/id/);
    expect(() => assertModelsUsable([{ id: 'a' }, { id: 'b' }])).not.toThrow();
  });
});

describe('端点 id 反推上游', () => {
  const presets = ['deepseek', 'openai', 'anthropic', 'glm'];

  it('新建的端点 id 能反推出上游', () => {
    expect(upstreamOf('deepseek-relay', presets)).toBe('deepseek');
    expect(upstreamOf('deepseek-relay-2', presets)).toBe('deepseek');
  });

  it('内置目录里的 id 就是它自己', () => {
    expect(upstreamOf('deepseek', presets)).toBe('deepseek');
  });

  it('认不出来时返回 null（不瞎猜）', () => {
    expect(upstreamOf('my-custom-thing', presets)).toBeNull();
  });

  it('手写的 id 里带上游名也能认出来（micuapi-deepseek / wode-glm）', () => {
    expect(upstreamOf('micuapi-deepseek', presets)).toBe('deepseek');
    expect(upstreamOf('wode-glm', presets)).toBe('glm');
    // 反例：别把域名里的词当上游（api-slb.micuapi.ai 里没有预设名）
    expect(upstreamOf('api-slb.micuapi.ai', presets)).toBeNull();
    expect(upstreamOf('wode', presets)).toBeNull();
  });
});

describe('哪些模型算「这个上游自己的」', () => {
  const catalog = ['deepseek-v4-flash', 'deepseek-v4-pro'];

  it('内置目录里有同名的一律算', () => {
    expect(recommendedModelIds('deepseek', ['deepseek-v4-pro'], [])).toEqual([
      'deepseek-v4-pro',
    ]);
  });

  it('名字像这个上游的也算（前缀）', () => {
    const upstream = [
      'deepseek-v4-flash',
      'deepseek-v4-flash-0731',
      'deepseek-v4.1-flash',
      'glm-5.3',
      'kimi-k3',
      'qwen3.8-max',
      'MiniMax-M3',
    ];

    // 真实案例：一个「DeepSeek」分组同时卖 glm / kimi / qwen，默认只勾 deepseek 的
    expect(recommendedModelIds('deepseek', upstream, catalog)).toEqual([
      'deepseek-v4-flash',
      'deepseek-v4-flash-0731',
      'deepseek-v4.1-flash',
    ]);
  });

  it('带厂商前缀的写法（moonshot/kimi-k3）按段匹配', () => {
    expect(recommendedModelIds('kimi', ['moonshot/kimi-k3', 'glm-5.3'], [])).toEqual([
      'moonshot/kimi-k3',
    ]);
    // deepseek-ai/DeepSeek-V3 这种也认（前缀命中）
    expect(recommendedModelIds('deepseek', ['deepseek-ai/DeepSeek-V3'], [])).toEqual([
      'deepseek-ai/DeepSeek-V3',
    ]);
  });

  it('大小写不敏感，且不会把别的厂商误认进来', () => {
    expect(recommendedModelIds('deepseek', ['DeepSeek-V3'], [])).toEqual(['DeepSeek-V3']);
    expect(recommendedModelIds('glm', ['glm-5.3', 'kimi-k3'], [])).toEqual(['glm-5.3']);
  });
});

describe('勾中的 id → 模型定义', () => {
  const catalog = [
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', api: 'openai-completions', contextWindow: 1000000 },
  ];

  it('目录里有同名定义就用目录那份（名字 / 上下文窗口 / 价格都在）', () => {
    expect(mergeModelDefinitions(['deepseek-v4-pro'], catalog)).toEqual(catalog);
  });

  it('目录里没有的（中转独有的模型）退回最小定义', () => {
    expect(mergeModelDefinitions(['deepseek-v4.1-flash'], catalog)).toEqual([
      { id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash', api: 'openai-completions' },
    ]);
  });

  it('去重、跳过空 id，顺序按勾选清单', () => {
    expect(
      mergeModelDefinitions(['b', 'a', 'b', '', '  '], []).map(model => model.id)
    ).toEqual(['b', 'a']);
  });
});

describe('找出这个上游已有的端点', () => {
  const ids = ['deepseek', 'deepseek-relay', 'deepseek-relay-2', 'glm-relay', 'wode'];

  it('只认派生出来的（不含官方条目本身）', () => {
    expect(derivedEndpointIds('deepseek', ids)).toEqual(['deepseek-relay', 'deepseek-relay-2']);
    expect(derivedEndpointIds('glm', ids)).toEqual(['glm-relay']);
  });

  it('手写 id 不算派生端点（那要走「id 就是 provider」那条路）', () => {
    expect(derivedEndpointIds('deepseek', ['micuapi-deepseek'])).toEqual([]);
  });

  it('地址比较：尾斜杠 / 大小写 / 空格归一化', () => {
    expect(sameEndpointUrl('https://R.example/v1/', ' https://r.example/v1 ')).toBe(true);
    expect(sameEndpointUrl('https://r.example/v1', 'https://r.example/v1/')).toBe(true);
  });

  it('路径不同就是不同地址（/v1 与 /1 不能当同一个）', () => {
    expect(sameEndpointUrl('https://api.example/v1', 'https://api.example/1')).toBe(false);
  });

  it('空的 / 非字符串一律不同（别把「没填」当成匹配上）', () => {
    expect(sameEndpointUrl('', '')).toBe(false);
    expect(sameEndpointUrl(undefined, undefined)).toBe(false);
    expect(sameEndpointUrl('https://r.example/v1', undefined)).toBe(false);
  });
});
