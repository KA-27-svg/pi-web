import { describe, expect, it } from 'vitest';
import { PROVIDER_ENV_VARS, PROVIDER_PRESETS, SUBSCRIPTION_LOGINS } from './providers';

describe('PROVIDER_PRESETS', () => {
  it('id 唯一——它直接当 auth.json 的键用，重复会互相覆盖', () => {
    const ids = PROVIDER_PRESETS.map(preset => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每项都有展示名', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.label.trim()).not.toBe('');
    }
  });

  it('只支持订阅的供应商不声明环境变量', () => {
    // 声明了就会让「设了这个环境变量 = 已配置」的判断给出错误结论
    for (const preset of PROVIDER_PRESETS) {
      if (preset.subscriptionOnly) expect(preset.envVar).toBe('');
      else expect(preset.envVar).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });
});

describe('PROVIDER_ENV_VARS', () => {
  it('与环境变量非空的预设一一对应', () => {
    const expected = Object.fromEntries(
      PROVIDER_PRESETS.filter(preset => preset.envVar).map(preset => [preset.id, preset.envVar])
    );
    expect(PROVIDER_ENV_VARS).toEqual(expected);
  });

  it('不含空值，否则空环境变量也会被判成已配置', () => {
    for (const envVar of Object.values(PROVIDER_ENV_VARS)) {
      expect(envVar.trim()).not.toBe('');
    }
  });
});

describe('SUBSCRIPTION_LOGINS', () => {
  it('id 唯一', () => {
    const ids = SUBSCRIPTION_LOGINS.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每项都有展示名', () => {
    for (const entry of SUBSCRIPTION_LOGINS) {
      expect(entry.label.trim()).not.toBe('');
    }
  });
});
