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
  gitBash: { required: true, available: true, path: 'C:\\Program Files\\Git\\bin\\bash.exe', mode: 'bash' },
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

const click = (el: Element | null | undefined) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('SettingsPanel 环境自检', () => {
  it('把本机配置摊开：Node、pi、Git Bash', () => {
    render(setup());

    expect(text()).toContain('环境自检');
    expect(text()).toContain('v22.23.2');
    expect(text()).toContain('0.85.1');
    // 找到时显示具体路径：说「缺 Git Bash」的时候，用户得能看出来我们找过哪里
    expect(text()).toContain('C:\\Program Files\\Git\\bin\\bash.exe');
  });

  it('没找到 Git Bash 但已用 PowerShell 顶替时说清楚，而不是只写「未找到」', () => {
    // 只说「未找到」会让人以为这台机器跑不了命令，实际已经能跑了
    render(
      setup({ gitBash: { required: true, available: false, path: null, mode: 'powershell' } })
    );

    expect(text()).toContain('PowerShell');
  });

  it('没找到 Git Bash 而且没顶替时只说「未找到」', () => {
    render(setup({ gitBash: { required: true, available: false, path: null, mode: 'bash' } }));

    expect(text()).toContain('未找到');
    expect(text()).not.toContain('PowerShell');
  });

  it('Node 版本不够时把门槛一起写出来', () => {
    render(setup({ node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' } }));

    expect(text()).toContain('20.19.0');
    expect(text()).toContain('22.19.0');
  });

  it('非 Windows 平台不显示 Git Bash 这一行', () => {
    render(setup({ platform: 'linux', gitBash: { required: false, available: true, path: null, mode: 'bash' } }));

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

describe('SettingsPanel 重新检测的点击反馈', () => {
  it('点下去立刻变成「检测中…」并转圈', () => {
    // 这一下要跑 node / npm / pi 几条命令，得等一两秒；不报状态的话，
    // 用户点完只看到同一幅画面，会以为没点上
    const onRecheckSetup = render(setup());
    const button = recheckButton();

    click(button);

    expect(onRecheckSetup).toHaveBeenCalledTimes(1);
    expect(text()).toContain('检测中…');
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(host.querySelector('.animate-spin')).toBeTruthy();
  });

  it('探测结果换了新对象后，短暂显示「已刷新」', () => {
    vi.useFakeTimers();
    try {
      render(setup());
      click(recheckButton());

      // 桥接每次都用新建的 setup 对象广播回来
      act(() => {
        root.render(
          <SettingsPanel
            status={{ connected: true, cwd: '/demo', isStreaming: false, setup: setup() }}
            onClose={vi.fn()}
            onSelectModel={vi.fn()}
            onSelectThinkingLevel={vi.fn()}
            onRecheckSetup={vi.fn()}
          />
        );
      });

      // 数据到了也要把转圈走完，不然一下跳过去看不出在刷
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(host.querySelector('.animate-spin')).toBeNull();
      expect(text()).toContain('已刷新');
    } finally {
      vi.useRealTimers();
    }
  });
});
