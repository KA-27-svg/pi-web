// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, ApiProbeResult, SetupStatus } from '../types/pi';
import { SettingsPanel } from './SettingsPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  window.localStorage.clear();
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

const render = (
  s: SetupStatus | undefined,
  onRecheckSetup = vi.fn(),
  extra: Partial<BridgeStatus> = {},
  onProbeApi: (input: {
    provider: string;
    modelId: string;
    baseUrl: string;
    api?: string;
  }) => Promise<ApiProbeResult> = async () => ({ ok: false, keyUsed: false })
) => {
  const status: BridgeStatus = {
    connected: true,
    cwd: '/demo',
    isStreaming: false,
    setup: s,
    ...extra,
  };

  act(() => {
    root.render(
      <SettingsPanel
        status={status}
        onClose={vi.fn()}
        onSelectModel={vi.fn()}
        onSelectThinkingLevel={vi.fn()}
        onRecheckSetup={onRecheckSetup}
        onCompact={vi.fn()}
        onProbeApi={onProbeApi}
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

  it('点「重新检测」一把测两样：本机探测 + API 上游', async () => {
    const onRecheckSetup = vi.fn();
    const onProbeApi = vi.fn(async () => ({
      ok: true,
      status: 200,
      ms: 123,
      modelFound: true,
      keyUsed: true,
    }));
    render(
      setup(),
      onRecheckSetup,
      {
        model: {
          id: 'deepseek-flash',
          name: 'DeepSeek V4.1 Flash',
          provider: 'micuapi-deepseek',
          baseUrl: 'https://api.deepseek.com',
          api: 'openai-completions',
        },
      },
      onProbeApi
    );

    click(recheckButton());
    await act(async () => {});

    expect(onRecheckSetup).toHaveBeenCalledTimes(1);
    // 带上当前模型的供应商 / 模型 / 地址 / api 类型，桥接才拿得到密钥
    expect(onProbeApi).toHaveBeenCalledWith({
      provider: 'micuapi-deepseek',
      modelId: 'deepseek-flash',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
    });
    expect(text()).toContain('模型在列');
  });

  it('上游鉴权失败时说清楚，不冒充「能用」', async () => {
    const onProbeApi = vi.fn(async () => ({
      ok: false,
      status: 401,
      keyUsed: true,
      error: '鉴权失败（HTTP 401）',
    }));
    render(
      setup(),
      vi.fn(),
      { model: { id: 'm', name: 'M', provider: 'p', baseUrl: 'https://relay.example/v1' } },
      onProbeApi
    );

    click(recheckButton());
    await act(async () => {});

    expect(text()).toContain('鉴权失败');
  });

  it('模型不在上游列表里时提醒一句', async () => {
    const onProbeApi = vi.fn(async () => ({
      ok: true,
      status: 200,
      ms: 50,
      modelFound: false,
      keyUsed: true,
    }));
    render(
      setup(),
      vi.fn(),
      { model: { id: 'nope', name: 'M', provider: 'p', baseUrl: 'https://relay.example/v1' } },
      onProbeApi
    );

    click(recheckButton());
    await act(async () => {});

    expect(text()).toContain('列表里没有');
  });

  it('API 上游排在 Node 前面', () => {
    render(
      setup(),
      vi.fn(),
      { model: { id: 'm', name: 'M', provider: 'p', baseUrl: 'https://relay.example/v1' } },
      async () => ({ ok: false, keyUsed: false })
    );

    const body = text();
    expect(body.indexOf('API 上游')).toBeGreaterThan(-1);
    expect(body.indexOf('API 上游')).toBeLessThan(body.indexOf('Node'));
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

const MODELS = [
  { id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'micuapi-openai' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', provider: 'micuapi-deepseek' },
  { id: 'old-model-3.5', name: 'Old Model 3.5', provider: 'micuapi-openai' },
];

const findButton = (label: string) =>
  [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label);

const hideButton = (modelId: string) =>
  host.querySelector(`button[aria-label="隐藏 ${modelId}"]`);
const restoreButton = (modelId: string) =>
  host.querySelector(`button[aria-label="恢复 ${modelId}"]`);

const openPicker = (extra: Partial<BridgeStatus> = {}) => {
  render(setup(), vi.fn(), { availableModels: MODELS, ...extra });
  // 触发按钮上是「模型」加当前模型名（这里没有当前模型，所以是「模型—」）
  const trigger = [...host.querySelectorAll('button')].find(b =>
    b.textContent?.includes('模型')
  );
  click(trigger);
};

describe('SettingsPanel 模型管理', () => {
  it('不常用的可以藏起来，藏了就不出现在列表里', () => {
    // 用户那边有 72 个模型，每次选都得翻半天
    openPicker();
    expect(text()).toContain('Old Model 3.5');

    click(findButton('管理'));
    click(hideButton('old-model-3.5'));
    click(findButton('完成'));

    expect(text()).not.toContain('Old Model 3.5');
    expect(text()).toContain('DeepSeek V4 Pro');
  });

  it('藏起来只记在浏览器里，不动 pi 的配置文件', () => {
    // pi 那份 models.json 是用户手写的，每个模型上带着 cost / compat，写回一次就全没了
    openPicker();
    click(findButton('管理'));
    click(hideButton('old-model-3.5'));

    expect(JSON.parse(window.localStorage.getItem('pi-web:hidden-models') ?? '[]')).toEqual([
      'micuapi-openai/old-model-3.5',
    ]);
  });

  it('藏了还能恢复', () => {
    openPicker();
    click(findButton('管理'));
    click(hideButton('old-model-3.5'));
    click(findButton('完成'));
    // 不管理的时候连「已隐藏」那一组都不显示，就是干干静静地少了一行
    expect(text()).not.toContain('Old Model 3.5');

    click(findButton('管理'));
    expect(text()).toContain('已隐藏');
    click(restoreButton('old-model-3.5'));
    click(findButton('完成'));

    expect(text()).toContain('Old Model 3.5');
  });

  it('全藏了也打得开选择器，不然就回不去恢复了', () => {
    window.localStorage.setItem(
      'pi-web:hidden-models',
      JSON.stringify(MODELS.map(m => `${m.provider}/${m.id}`))
    );
    render(setup(), vi.fn(), { availableModels: MODELS });

    click([...host.querySelectorAll('button')].find(b => b.textContent?.includes('模型')));

    expect(text()).toContain('模型都被藏起来了');
    click(findButton('管理'));
    expect(restoreButton('gpt-6-astra')).toBeTruthy();
  });

  it('藏过的那个即使正被用着也照常显示在上面', () => {
    // 只是不列在菜单里，不是把正在用的模型弄没
    openPicker({ model: { id: 'gpt-6-astra', name: 'GPT-6 Astra', provider: 'micuapi-openai' } });
    click(findButton('管理'));
    click(hideButton('gpt-6-astra'));
    click(findButton('完成'));

    // 触发按钮上仍然是它（那个按钮的文字是「模型」+ 当前模型名）
    const trigger = [...host.querySelectorAll('button')].find(b =>
      b.textContent?.includes('模型')
    );
    expect(trigger?.textContent).toContain('GPT-6 Astra');
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
            onCompact={vi.fn()}
            onProbeApi={async () => ({ ok: false, keyUsed: false })}
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

describe('切模型失败', () => {
  it('在设置面板里就地显示原因（侧栏收起时提示条看不见）', () => {
    render(setup(), vi.fn(), { modelNotice: '切换模型失败：Model not found: x/y' });

    expect(text()).toContain('切换模型失败');
    expect(text()).toContain('Model not found');
  });

  it('没有出错时不占位置', () => {
    render(setup());
    expect(text()).not.toContain('切换模型失败');
  });
});

describe('上下文提示与压缩', () => {
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };

  const renderPanel = (
    percent: number,
    extra: Partial<BridgeStatus> = {},
    onCompact = vi.fn()
  ) => {
    act(() => {
      root.render(
        <SettingsPanel
          status={{
            connected: true,
            cwd: '/demo',
            isStreaming: false,
            stats: { cost: 0, tokens, contextUsage: { tokens: 60000, contextWindow: 100000, percent } },
            ...extra,
          }}
          onClose={vi.fn()}
          onSelectModel={vi.fn()}
          onSelectThinkingLevel={vi.fn()}
          onRecheckSetup={vi.fn()}
          onCompact={onCompact}
          onProbeApi={async () => ({ ok: false, keyUsed: false })}
        />
      );
    });
    return onCompact;
  };

  const compactButton = () =>
    [...host.querySelectorAll('button')].find(b => b.textContent?.includes('压缩')) as
      | HTMLButtonElement
      | undefined;

  it('占用过半才摆出「压缩上下文」，点了会回调', () => {
    const onCompact = renderPanel(60);

    click(compactButton());
    expect(onCompact).toHaveBeenCalledTimes(1);
  });

  it('占用不到一半时不摆这个按钮', () => {
    renderPanel(30);

    expect(compactButton()).toBeUndefined();
  });

  it('压缩中时按钮不可点，并说明正在压缩', () => {
    renderPanel(60, { compacting: true });

    expect(compactButton()?.disabled).toBe(true);
    expect(compactButton()?.textContent).toContain('正在压缩');
  });

  it('压缩完成后把结果显示出来', () => {
    renderPanel(60, { compactionNotice: '上下文已压缩：150k → 32k' });

    expect(text()).toContain('150k → 32k');
  });
});

describe('桥接是旧进程时不甩英文', () => {
  it('Unknown command 提示重启，而不是把英文原样丢出来', async () => {
    const onProbeApi = vi.fn(async () => ({
      ok: false,
      keyUsed: true,
      error: 'Unknown command: probe_api',
    }));
    render(
      setup(),
      vi.fn(),
      { model: { id: 'm', name: 'M', provider: 'p', baseUrl: 'https://relay.example/v1' } },
      onProbeApi
    );

    click(recheckButton());
    await act(async () => {});

    expect(text()).toContain('桥接是旧进程，重启一下再试');
    expect(text()).not.toContain('Unknown command');
  });
});
