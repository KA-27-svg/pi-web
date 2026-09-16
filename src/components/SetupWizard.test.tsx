// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, SetupStatus } from '../types/pi';
import { SetupWizard } from './SetupWizard';

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
  pi: { installed: false, version: null },
  gitBash: { required: true, available: true },
  ready: false,
  issues: [{ code: 'pi-missing', message: '这台机器上还没安装 pi。' }],
  ...over,
});

const status = (s: SetupStatus): BridgeStatus => ({
  connected: true,
  cwd: 'C:\\demo',
  isStreaming: false,
  setup: s,
});

const render = (s: SetupStatus, onRecheck = vi.fn()) => {
  act(() => {
    root.render(<SetupWizard status={status(s)} onRecheck={onRecheck} />);
  });
  return onRecheck;
};

const text = () => host.textContent ?? '';

describe('SetupWizard', () => {
  it('把每条问题都展示出来', () => {
    render(
      setup({
        issues: [
          { code: 'node-too-old', message: 'Node.js 版本过低（当前 v20.19.0）。' },
          { code: 'pi-missing', message: '这台机器上还没安装 pi。' },
        ],
      })
    );

    expect(text()).toContain('Node.js 版本过低');
    expect(text()).toContain('还没安装 pi');
  });

  it('展示探测到的版本，便于用户排查', () => {
    render(setup());

    expect(text()).toContain('v22.23.2');
  });

  it('展示缺失的版本门槛，让用户知道差多少', () => {
    render(
      setup({
        node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' },
        issues: [{ code: 'node-too-old', message: 'Node.js 版本过低（当前 v20.19.0）。' }],
      })
    );

    expect(text()).toContain('22.19.0');
  });

  it('点「重新检测」会通知上层', () => {
    const onRecheck = render(setup());
    const button = [...host.querySelectorAll('button')].find(b =>
      b.textContent?.includes('重新检测')
    );

    expect(button).toBeDefined();
    act(() => {
      button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onRecheck).toHaveBeenCalledTimes(1);
  });
});
