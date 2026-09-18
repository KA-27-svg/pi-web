import { describe, expect, it } from 'vitest';
import {
  assertModelsUsable,
  catalogModelsFor,
  deriveEndpointId,
  isPresetProvider,
  presetLabel,
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
