// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, SetupStatus } from '../types/pi';
import { SetupWizard } from './SetupWizard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;
let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const COMMAND = 'curl -fsSL https://pi.dev/install.sh | sh';

const setup = (over: Partial<SetupStatus> = {}): SetupStatus => ({
  platform: 'linux',
  node: { version: 'v22.23.2', ok: true, minimum: '22.19.0' },
  npm: { available: true },
  pi: { installed: false, version: null },
  gitBash: { required: false, available: true, path: null, mode: 'bash' },
  credentials: { providers: ['anthropic'] },
  ready: false,
  issues: [{ code: 'pi-missing', message: '这台机器上还没安装 pi。' }],
  ...over,
});

const status = (s: SetupStatus, extra: Partial<BridgeStatus> = {}): BridgeStatus => ({
  connected: true,
  cwd: '/demo',
  isStreaming: false,
  setup: s,
  installCommand: COMMAND,
  preflight: { allowed: true },
  ...extra,
});

const render = (
  s: SetupStatus,
  extra: Partial<BridgeStatus> = {},
  handlers: {
    onRecheck?: () => void;
    onInstall?: () => void;
    onSaveProvider?: (p: string, k: string) => void;

  } = {}
) => {
  const onRecheck = handlers.onRecheck ?? vi.fn();
  const onInstall = handlers.onInstall ?? vi.fn();
  const onSaveProvider = handlers.onSaveProvider ?? vi.fn();


  act(() => {
    root.render(
      <SetupWizard
        status={status(s, extra)}
        onRecheck={onRecheck}
        onInstall={onInstall}
        onSaveProvider={onSaveProvider}
      />
    );
  });

  return { onRecheck, onInstall, onSaveProvider };
};

const text = () => host.textContent ?? '';
const buttonWith = (label: string) =>
  [...host.querySelectorAll('button')].find(b => b.textContent?.includes(label));
const click = (el: Element | undefined) => {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('SetupWizard 说明', () => {
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

  it('展示探测到的版本与门槛，让用户知道差多少', () => {
    render(setup({ node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' } }));

    expect(text()).toContain('v20.19.0');
    expect(text()).toContain('22.19.0');
  });
});

describe('SetupWizard 安装', () => {
  it('执行前先把官方命令原文摆出来', () => {
    // 不管走哪条路，用户都得先看见到底要跑什么
    render(setup());

    expect(text()).toContain(COMMAND);
  });

  it('可以一键复制官方命令', async () => {
    render(setup());
    click(buttonWith('复制'));

    expect(writeText).toHaveBeenCalledWith(COMMAND);
  });

  it('允许代跑时给出安装按钮，点击后通知上层', () => {
    const { onInstall } = render(setup());

    click(buttonWith('帮我安装'));

    expect(onInstall).toHaveBeenCalledTimes(1);
  });

  it('不允许代跑时说明原因，并且不给安装按钮', () => {
    render(setup({ node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' } }), {
      preflight: { allowed: false, reason: 'Node.js 版本不够（pi 需要 22.19.0 或更新）。' },
    });

    expect(text()).toContain('Node.js 版本不够');
    expect(buttonWith('帮我安装')).toBeUndefined();
    // 命令仍然要在，用户得能自己跑
    expect(text()).toContain(COMMAND);
  });

  it('安装中显示日志，并藏掉安装按钮', () => {
    render(
      { ...setup(), ready: false },
      {
        installing: true,
        installLog: ['Installing Pi...', 'fetching tarballs (12)'],
      }
    );

    expect(text()).toContain('fetching tarballs (12)');
    expect(buttonWith('帮我安装')).toBeUndefined();
  });

  it('安装失败时把原因显示出来', () => {
    render(setup(), { installError: '安装器以退出码 1 结束' });

    expect(text()).toContain('安装器以退出码 1 结束');
  });
});

describe('SetupWizard 按缺什么决定展示', () => {
  const installed = (over: Partial<SetupStatus> = {}) =>
    setup({
      pi: { installed: true, version: '0.85.1' },
      ...over,
    });

  it('装了 pi 但没配凭证时，展示配置模型而不是安装', () => {
    // 这两种情况该做的事完全不同：一个是装 pi，一个是填 key
    render(
      installed({
        credentials: { providers: [] },
        issues: [{ code: 'no-credentials', message: '还没有配置任何模型凭证。' }],
      })
    );

    expect(text()).toContain('配置模型');
    expect(buttonWith('帮我安装')).toBeUndefined();
  });

  it('没装 pi 时不展示配置模型', () => {
    render(setup());

    expect(text()).not.toContain('配置模型');
  });

  it('装了 pi 且已有凭证时也不展示配置模型', () => {
    render(installed({ credentials: { providers: ['anthropic'] } }));

    expect(text()).not.toContain('配置模型');
  });
});

describe('SetupWizard 自动轮询', () => {
  it('未就绪时定期重新探测，用户在自己终端装完后页面能自己认出来', () => {
    vi.useFakeTimers();
    const onRecheck = vi.fn();
    render(setup(), {}, { onRecheck });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(onRecheck.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('正在安装时不轮询，免得和安装流程抢', () => {
    vi.useFakeTimers();
    const onRecheck = vi.fn();
    render(setup(), { installing: true }, { onRecheck });

    act(() => {
      vi.advanceTimersByTime(10_000);
    });

    expect(onRecheck).not.toHaveBeenCalled();
  });

  it('点「重新检测」也会通知上层', () => {
    const { onRecheck } = render(setup());
    click(buttonWith('重新检测'));

    expect(onRecheck).toHaveBeenCalledTimes(1);
  });
});
