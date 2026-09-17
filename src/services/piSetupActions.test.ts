import { describe, expect, it, vi } from 'vitest';
import type { PiBridge } from './piBridge';
import { createSetupActions } from './piSetupActions';

function harness(requestResult: unknown = {}) {
  const sent: Record<string, any>[] = [];
  const request = vi.fn(async () => requestResult);

  const bridge = {
    setMessages: vi.fn(),
    setStatus: vi.fn(),
    handler: {} as never,
    request,
    sendCommand: (command: object) => {
      sent.push(command as Record<string, any>);
    },
    isOpen: () => true,
  } as unknown as PiBridge;

  return { actions: createSetupActions(bridge), sent, request };
}

describe('setup 动作', () => {
  it('重新探测与代跑安装', () => {
    const { actions, sent } = harness();

    actions.requestSetupStatus();
    actions.installPi();

    expect(sent).toEqual([{ type: 'get_setup_status' }, { type: 'install_pi' }]);
  });

  it('保存供应商凭证', () => {
    const { actions, sent } = harness();

    actions.saveProviderKey('deepseek', 'sk-1');

    expect(sent).toEqual([
      { type: 'save_provider_key', provider: 'deepseek', key: 'sk-1', name: '' },
    ]);
  });

  it('走中转站时把 baseUrl 带上；名字总是发（空串 = 退回官方名）', () => {
    const { actions, sent } = harness();

    actions.saveProviderKey('deepseek', 'sk-1', 'https://relay.example/v1', '我的中转站');

    expect(sent).toEqual([
      {
        type: 'save_provider_key',
        provider: 'deepseek',
        key: 'sk-1',
        baseUrl: 'https://relay.example/v1',
        name: '我的中转站',
      },
    ]);
  });

  it('自定义端点的供应商 id 走 providerId，不能占用 id', () => {
    // `id` 是桥接请求/回包配对用的。之前这里也叫 id，一旦改用 request 发指令，
    // 供应商 id 就会被配对 id 顶掉（实测回包里的 id 变成了供应商名）。
    const { actions, sent } = harness();

    actions.saveCustomProvider({
      id: 'my-relay',
      label: '我的中转站',
      baseUrl: 'https://relay.example/v1',
      api: 'openai-completions',
      models: ['gpt-x'],
      key: 'sk-1',
    });

    expect(sent[0].type).toBe('save_custom_provider');
    expect(sent[0].providerId).toBe('my-relay');
    expect(sent[0]).not.toHaveProperty('id');
    expect(sent[0].models).toEqual(['gpt-x']);
  });

  it('拉模型列表必须拿回结果，所以走 request', () => {
    const { actions, request } = harness({ models: ['m1', 'm2'] });

    return actions.listProviderModels('https://relay.example/v1', 'sk-1').then(models => {
      expect(models).toEqual(['m1', 'm2']);
      expect(request).toHaveBeenCalledWith('list_provider_models', {
        baseUrl: 'https://relay.example/v1',
        key: 'sk-1',
      });
    });
  });

  it('桥接没给 models 字段时返回空数组，而不是 undefined', () => {
    const { actions } = harness({});

    return actions.listProviderModels('https://x/v1', '').then(models => {
      expect(models).toEqual([]);
    });
  });
});
