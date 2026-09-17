import { describe, expect, it } from 'vitest';
import type { BridgeStatus } from '../types/pi';
import { providerLabel } from './providerLabel';

const status = (extra: Partial<BridgeStatus> = {}): BridgeStatus => ({
  connected: true,
  cwd: '/demo',
  isStreaming: false,
  providers: [
    { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
    { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY' },
  ],
  ...extra,
});

describe('providerLabel', () => {
  it('用户自己起过名字就用它', () => {
    // 名字存在 pi 的 models.json 里，pi 那边也认，所以两边显示一致
    expect(providerLabel(status({ providerNames: { deepseek: '我的中转站' } }), 'deepseek')).toBe(
      '我的中转站'
    );
  });

  it('起名字前用内置目录的官方名', () => {
    expect(providerLabel(status(), 'deepseek')).toBe('DeepSeek');
  });

  it('内置目录里也没有就退回 id，而不是空白', () => {
    expect(providerLabel(status(), 'api-slb.micuapi.ai')).toBe('api-slb.micuapi.ai');
  });

  it('名字是空白字符串时不算起过名', () => {
    // 桥接那边读的时候会把纯空白的过滤掉，这里也一致
    expect(providerLabel(status({ providerNames: { deepseek: '   ' } }), 'deepseek')).toBe(
      'DeepSeek'
    );
  });

  it('只给一个供应商起名不影响别的', () => {
    const s = status({ providerNames: { deepseek: '我的中转站' } });

    expect(providerLabel(s, 'deepseek')).toBe('我的中转站');
    expect(providerLabel(s, 'openai')).toBe('OpenAI');
  });
});
