import { describe, expect, it, vi } from 'vitest';
import type { PiBridge } from './piBridge';
import { createSetupActions } from './piSetupActions';

function harness() {
  const sent: Record<string, any>[] = [];

  const bridge = {
    setMessages: vi.fn(),
    setStatus: vi.fn(),
    handler: {} as never,
    request: vi.fn(),
    sendCommand: (command: object) => {
      sent.push(command as Record<string, any>);
    },
    isOpen: () => true,
  } as unknown as PiBridge;

  return { actions: createSetupActions(bridge), sent };
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

  it('走中转站时带上 baseUrl 与 newEndpoint；名字总是发（空串 = 退回官方名）', () => {
    // baseUrl 现在的语义是「独立端点」：新的供应商 id，不动官方条目
    const { actions, sent } = harness();

    actions.saveProviderKey('deepseek', 'sk-1', 'https://relay.example/v1', '我的中转站');

    expect(sent).toEqual([
      {
        type: 'save_provider_key',
        provider: 'deepseek',
        key: 'sk-1',
        baseUrl: 'https://relay.example/v1',
        newEndpoint: true,
        name: '我的中转站',
      },
    ]);
  });

  it('地址留空时不带 baseUrl / newEndpoint（配的是官方入口）', () => {
    const { actions, sent } = harness();

    actions.saveProviderKey('deepseek', 'sk-1', undefined, '');

    expect(sent).toEqual([
      { type: 'save_provider_key', provider: 'deepseek', key: 'sk-1', name: '' },
    ]);
  });
});
