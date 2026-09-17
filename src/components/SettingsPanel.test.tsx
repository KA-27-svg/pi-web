// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, CustomProviderDraft, ProviderPreset, SetupStatus } from '../types/pi';
import { SettingsPanel } from './SettingsPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  onSaveProvider = vi.fn();
  onListModels = vi.fn(async () => [] as string[]);
  onSaveCustom = vi.fn();
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

const PROVIDERS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
];

// 显式写成目标签名，别用 ReturnType<typeof vi.fn>：那个类型太宽（带构造签名），
// 传给组件 props 时 tsc 不认
let onSaveProvider: (provider: string, key: string) => void;
let onListModels: (baseUrl: string, key: string) => Promise<string[]>;
let onSaveCustom: (draft: CustomProviderDraft) => void;

const render = (s: SetupStatus | undefined, onRecheckSetup = vi.fn()) => {
  const status: BridgeStatus = {
    connected: true,
    cwd: '/demo',
    isStreaming: false,
    setup: s,
    providers: PROVIDERS,
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
        onSaveProvider={onSaveProvider}
        onListModels={onListModels}
        onSaveCustom={onSaveCustom}
      />
    );
  });

  return onRecheckSetup;
};

const text = () => host.textContent ?? '';
const recheckButton = () =>
  [...host.querySelectorAll('button')].find(button => button.textContent?.includes('重新检测'));

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

/** React 受控组件：必须走原生 setter，直接改 value 不会触发 onChange */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}

const findButton = (label: string) =>
  [...host.querySelectorAll('button')].find(button => button.textContent?.includes(label));

const click = (el: Element | null | undefined) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

const passwordInput = () => host.querySelector('input[type="password"]') as HTMLInputElement | null;

const submitForm = () => click(host.querySelector('button[type="submit"]'));

describe('SettingsPanel 模型供应商', () => {
  it('已经配过凭证时，设置里仍然有添加入口', () => {
    // 这是以前的缺口：向导只在「一个凭证都没有」时显示，配完第一个它就永远消失，
    // 想再加一个供应商只能去终端改 pi 的配置文件
    render(setup());

    expect(text()).toContain('模型供应商');
    expect(text()).toContain('Anthropic (Claude)');
    expect(text()).toContain('DeepSeek');
    expect(findButton('添加 / 更换')).toBeTruthy();
  });

  it('一个凭证都没有时说清要先加一个', () => {
    render(setup({ credentials: { providers: [] } }));

    expect(text()).toContain('还没有配置');
  });

  it('表单默认收起，不把一堆积输入项一直摊在设置里', () => {
    render(setup());

    expect(passwordInput()).toBeNull();
  });

  it('展开后能选供应商、贴 key 并保存', () => {
    render(setup());
    click(findButton('添加 / 更换'));

    setValue(host.querySelector('select') as HTMLSelectElement, 'deepseek');
    setValue(passwordInput() as HTMLInputElement, 'sk-ds-1');
    submitForm();

    expect(onSaveProvider).toHaveBeenCalledWith('deepseek', 'sk-ds-1');
  });

  it('设置里用的是「保存」，不是向导里的「保存并开始」', () => {
    // 这里是半路加一个供应商，不是什么「开始」，而且外面已经有分区标题了
    render(setup());
    click(findButton('添加 / 更换'));

    expect(text()).not.toContain('保存并开始');
    expect(host.querySelector('button[type="submit"]')?.textContent).toContain('保存');
  });

  it('也能加自定义端点（中转站 / 自建服务）', () => {
    render(setup());
    click(findButton('添加 / 更换'));

    expect(text()).toContain('自定义端点');
  });
});
