// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, ProviderPreset, SetupStatus } from '../types/pi';
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

describe('ProviderSetup 订阅登录引导', () => {  it('列出可以用订阅登录的提供商', () => {
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

describe('ProviderSetup 保存反馈', () => {
  /** 桥接每次广播的都是新建的 setup 对象，这里就靠它换引用来判「存上了」 */
  const setup = (): SetupStatus =>
    ({
      platform: 'win32',
      node: { version: 'v22.23.2', ok: true, minimum: '22.19.0' },
      npm: { available: true },
      pi: { installed: true, version: '0.85.1' },
      gitBash: { required: true, available: true, path: null, mode: 'bash' },
      credentials: { providers: [] },
      ready: false,
      issues: [],
    }) as SetupStatus;

  it('存上之后按钮说「已保存」，不然点一下什么都不变', () => {
    vi.useFakeTimers();
    try {
      render({ setup: setup() });
      setValue(keyInput(), 'sk-1');
      submit();

      // 回包还没到
      expect(submitButton().textContent).toContain('保存并开始');

      render({ setup: setup() });
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(submitButton().textContent).toContain('已保存');
    } finally {
      vi.useRealTimers();
    }
  });

  it('过一会儿回到原来的文案，不会一直挂着「已保存」', () => {
    vi.useFakeTimers();
    try {
      render({ setup: setup() });
      setValue(keyInput(), 'sk-1');
      submit();
      render({ setup: setup() });

      // 分两步推进：effect 是在 act 退出时才 flush 的，那个 1200ms 的定时器
      // 要到那时才被建出来，一次推到底会推不到它
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(submitButton().textContent).toContain('已保存');

      act(() => {
        vi.advanceTimersByTime(1300);
      });

      expect(submitButton().textContent).toContain('保存并开始');
    } finally {
      vi.useRealTimers();
    }
  });
});
