// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, SetupStatus } from '../types/pi';
import { SettingsPanel } from './SettingsPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const setup = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  platform: 'win32',
  node: { version: 'v22.23.2', ok: true, minimum: '22.19.0' },
  npm: { available: true },
  pi: { installed: true, version: '0.85.1' },
  gitBash: { required: true, available: true },
  credentials: { providers: ['anthropic', 'deepseek'] },
  ready: true,
  issues: [],
  ...over,
});

const render = (s: SetupStatus | undefined, onRecheckSetup = vi.fn()) => {
  const status: BridgeStatus = {
    connected: true,
    cwd: '/demo',
    isStreaming: false,
    setup: s,
  };

  act(() => {
    root.render(
      <SettingsPanel
        status={status}
        onClose={vi.fn()}
        onChangeCwd={vi.fn()}
        onNewSession={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinkingLevel={vi.fn()}
        onRecheckSetup={onRecheckSetup}
      />
    );
  });

  return onRecheckSetup;
};

const text = () => host.textContent ?? '';
const recheckButton = () =>
  [...host.querySelectorAll('button')].find(button => button.textContent?.includes('重新检测'));

describe('SettingsPanel 环境自检', () => {
  it('把本机配置摊开：Node、pi、Git Bash、模型凭证', () => {
    render(setup());

    expect(text()).toContain('环境自检');
    expect(text()).toContain('v22.23.2');
    expect(text()).toContain('0.85.1');
    expect(text()).toContain('已找到');
    expect(text()).toContain('2 个供应商');
  });

  it('没配凭证时明说，而不是留空', () => {
    render(setup({ credentials: { providers: [] } }));

    expect(text()).toContain('还没有配置');
  });

  it('Node 版本不够时把门槛一起写出来', () => {
    render(setup({ node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' } }));

    expect(text()).toContain('20.19.0');
    expect(text()).toContain('22.19.0');
  });

  it('非 Windows 平台不显示 Git Bash 这一行', () => {
    render(setup({ platform: 'linux', gitBash: { required: false, available: true } }));

    expect(text()).not.toContain('Git Bash');
  });

  it('说明只查本机配置，不冒充连通性检测', () => {
    // 真测连通性要发一条会产生真实费用的请求，不该悄悄跑
    render(setup());

    expect(text()).toContain('不测网络连通性');
  });

  it('还没拿到探测结果时整段不显示', () => {
    render(undefined);

    expect(text()).not.toContain('环境自检');
  });

  it('点「重新检测」会通知上层', () => {
    const onRecheckSetup = render(setup());

    act(() => {
      recheckButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onRecheckSetup).toHaveBeenCalledTimes(1);
  });
});
