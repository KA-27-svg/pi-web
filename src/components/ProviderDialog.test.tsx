// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, CustomProviderDraft, ProviderPreset } from '../types/pi';
import { ProviderDialog } from './ProviderDialog';

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

const PROVIDERS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
];

// 显式写成目标签名，别用 ReturnType<typeof vi.fn>：那个类型太宽（带构造签名），
// 传给组件 props 时 tsc 不认
let onSaveProvider: (provider: string, key: string) => void;
let onListModels: (baseUrl: string, key: string) => Promise<string[]>;
let onSaveCustom: (draft: CustomProviderDraft) => void;

const render = (
  configured: string[] = ['anthropic', 'deepseek'],
  onClose = vi.fn()
) => {
  const status: BridgeStatus = {
    connected: true,
    cwd: '/demo',
    isStreaming: false,
    providers: PROVIDERS,
    setup: {
      platform: 'win32',
      node: { version: 'v22.23.2', ok: true, minimum: '22.19.0' },
      npm: { available: true },
      pi: { installed: true, version: '0.85.1' },
      gitBash: { required: true, available: true, path: null, mode: 'bash' },
      credentials: { providers: configured },
      ready: true,
      issues: [],
    },
  };

  act(() => {
    root.render(
      <ProviderDialog
        status={status}
        onClose={onClose}
        onSaveProvider={onSaveProvider}
        onListModels={onListModels}
        onSaveCustom={onSaveCustom}
      />
    );
  });

  return onClose;
};

// 弹窗走传送门挂到 body 上，所以从 body 找，不是从 host
const text = () => document.body.textContent ?? '';
const passwordInput = () =>
  document.body.querySelector('input[type="password"]') as HTMLInputElement | null;

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

const click = (el: Element | null | undefined) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('ProviderDialog', () => {
  it('即使已经配过凭证也能打开——这正是它存在的理由', () => {
    // 首次运行向导只在「一个凭证都没有」时显示，配完第一个就永远消失。
    // 没有这个入口，加第二个供应商只能去终端改 pi 的 auth.json
    render(['anthropic', 'deepseek']);

    expect(text()).toContain('模型供应商');
    expect(text()).toContain('已经配好的');
    expect(text()).toContain('Anthropic (Claude)');
    expect(text()).toContain('DeepSeek');
  });

  it('一个凭证都没有时说清要先加一个', () => {
    render([]);

    expect(text()).toContain('还没有配置');
  });

  it('表单是直接摊开的，不用再点一次', () => {
    render();

    expect(passwordInput()).toBeTruthy();
  });

  it('能选供应商、贴 key 并保存', () => {
    render();

    setValue(document.body.querySelector('select') as HTMLSelectElement, 'deepseek');
    setValue(passwordInput() as HTMLInputElement, 'sk-ds-1');
    click(document.body.querySelector('button[type="submit"]'));

    expect(onSaveProvider).toHaveBeenCalledWith('deepseek', 'sk-ds-1');
  });

  it('按钮说「保存」，不是向导里的「保存并开始」', () => {
    // 这里是半路加一个供应商，不是什么「开始」
    render();

    expect(text()).not.toContain('保存并开始');
    expect(document.body.querySelector('button[type="submit"]')?.textContent).toContain('保存');
  });

  it('也能加自定义端点（中转站 / 自建服务）', () => {
    render();

    expect(text()).toContain('自定义端点');
  });

  it('点遮罩或按 Esc 会通知上层关闭', () => {
    const onClose = render();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
