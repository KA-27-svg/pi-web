// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, ProviderPreset } from '../types/pi';
import { ProviderSetup } from './ProviderSetup';

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

const PROVIDERS: ProviderPreset[] = [
  { id: 'anthropic', label: 'Anthropic (Claude)', envVar: 'ANTHROPIC_API_KEY' },
  { id: 'deepseek', label: 'DeepSeek', envVar: 'DEEPSEEK_API_KEY' },
];

const status = (extra: Partial<BridgeStatus> = {}): BridgeStatus => ({
  connected: true,
  cwd: '/demo',
  isStreaming: false,
  providers: PROVIDERS,
  subscriptions: [
    { id: 'anthropic', label: 'Claude Pro/Max' },
    { id: 'openai', label: 'ChatGPT Plus/Pro (Codex)' },
  ],
  ...extra,
});

const render = (extra: Partial<BridgeStatus> = {}, onSave = vi.fn()) => {
  act(() => {
    root.render(
      <ProviderSetup
        status={status(extra)}
        onSave={onSave}
        onListModels={async () => []}
        onSaveCustom={vi.fn()}
      />
    );
  });
  return onSave;
};

const select = () => host.querySelector('select') as HTMLSelectElement;
const keyInput = () => host.querySelector('input[type="password"]') as HTMLInputElement;
const submitButton = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
const text = () => host.textContent ?? '';

/** React 受控组件：必须走原生 setter，直接改 value 不会触发 onChange */
function setValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

const submit = () => {
  act(() => {
    submitButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

describe('ProviderSetup', () => {
  it('把可选供应商渲染成选项', () => {
    render();

    const options = [...select().querySelectorAll('option')];
    expect(options.map(o => o.value)).toEqual(['anthropic', 'deepseek']);
    expect(text()).toContain('Anthropic (Claude)');
  });

  it('填了 key 才能提交', () => {
    const onSave = render();

    expect(submitButton().disabled).toBe(true);

    setValue(keyInput(), 'sk-ant-1');
    expect(submitButton().disabled).toBe(false);

    submit();
    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1');
  });

  it('换成另一个供应商后，提交用它', () => {
    const onSave = render();

    setValue(select(), 'deepseek');
    setValue(keyInput(), 'sk-ds-1');
    submit();

    expect(onSave).toHaveBeenCalledWith('deepseek', 'sk-ds-1');
  });

  it('只有空白字符不算填了 key', () => {
    const onSave = render();

    setValue(keyInput(), '   ');
    expect(submitButton().disabled).toBe(true);

    submit();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('保存失败的原因显示出来，而不是点了没反应', () => {
    render({ setupNotice: 'API key 不能为空' });

    expect(text()).toContain('API key 不能为空');
  });

  it('key 输入框是密码类型，不该明文摊在屏幕上', () => {
    render();

    expect(keyInput().type).toBe('password');
  });
});

describe('ProviderSetup 订阅登录引导', () => {
  it('列出可以用订阅登录的提供商', () => {
    render();

    expect(text()).toContain('Claude Pro/Max');
    expect(text()).toContain('ChatGPT Plus/Pro (Codex)');
  });

  it('说清怎么做：在终端跑 /login', () => {
    // 这一步桥接做不了（是 TUI 交互流程），只能引导，所以必须写明白
    render();

    expect(text()).toContain('/login');
  });

  it('说明授权完成后页面会自己继续，用户不用回来点按钮', () => {
    render();

    expect(text()).toContain('自动');
  });
});
