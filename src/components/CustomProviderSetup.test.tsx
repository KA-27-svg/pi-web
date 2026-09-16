// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus } from '../types/pi';
import { CustomProviderSetup } from './CustomProviderSetup';

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

const status = (extra: Partial<BridgeStatus> = {}): BridgeStatus => ({
  connected: true,
  cwd: '/demo',
  isStreaming: false,
  ...extra,
});

const noopList = async () => [] as string[];

const render = (
  extra: Partial<BridgeStatus> = {},
  handlers: { onListModels?: (b: string, k: string) => Promise<string[]>; onSave?: (i: any) => void } = {}
) => {
  const onListModels = handlers.onListModels ?? vi.fn(noopList);
  const onSave = handlers.onSave ?? vi.fn();

  act(() => {
    root.render(
      <CustomProviderSetup
        status={status(extra)}
        onListModels={onListModels}
        onSave={onSave}
      />
    );
  });

  return { onListModels, onSave };
};

const field = (name: string) => host.querySelector(`[data-field="${name}"]`) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const saveButton = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
const listButton = () => host.querySelector('button[type="button"]') as HTMLButtonElement;
const text = () => host.textContent ?? '';

function setValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement
        : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}

const click = (el: Element | undefined) => {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const fill = (over: Record<string, string> = {}) => {
  setValue(field('id'), over.id ?? 'my-relay');
  setValue(field('baseUrl'), over.baseUrl ?? 'https://relay.example/v1');
  setValue(field('models'), over.models ?? 'gpt-x\nclaude-y');
};

describe('CustomProviderSetup', () => {
  it('四项必要信息都提供了输入位置', () => {
    render();

    expect(field('id')).toBeTruthy();
    expect(field('baseUrl')).toBeTruthy();
    expect(field('api')).toBeTruthy();
    expect(field('models')).toBeTruthy();
  });

  it('api 类型只给 pi 支持的那几种', () => {
    render();

    const values = [...(field('api') as HTMLSelectElement).querySelectorAll('option')].map(o => o.value);
    expect(values).toEqual([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ]);
  });

  it('填齐之前不能保存', () => {
    const { onSave } = render();

    expect(saveButton().disabled).toBe(true);

    fill();
    expect(saveButton().disabled).toBe(false);

    click(saveButton());
    expect(onSave).toHaveBeenCalledWith({
      id: 'my-relay',
      label: '',
      baseUrl: 'https://relay.example/v1',
      api: 'openai-completions',
      models: ['gpt-x', 'claude-y'],
      key: '',
    });
  });

  it('模型 id 按行拆开，忽略空行与首尾空白', () => {
    const onSave = vi.fn();
    render({}, { onSave });

    fill({ models: '  gpt-x  \n\n  claude-y\n' });
    click(saveButton());

    expect(onSave.mock.calls[0][0].models).toEqual(['gpt-x', 'claude-y']);
  });

  it('没有模型 id 时不能保存', () => {
    const onSave = vi.fn();
    render({}, { onSave });

    fill({ models: '   \n  ' });
    expect(saveButton().disabled).toBe(true);

    click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });

  it('key 输入框是密码类型', () => {
    render();

    expect(field('key').getAttribute('type')).toBe('password');
  });
});

describe('CustomProviderSetup 拉取模型列表', () => {
  it('把拉回来的模型填进输入框', async () => {
    const onListModels = vi.fn(async () => ['m1', 'm2']);
    render({}, { onListModels });

    setValue(field('baseUrl'), 'https://relay.example/v1');
    await act(async () => {
      click(listButton());
    });

    expect(onListModels).toHaveBeenCalledWith('https://relay.example/v1', '');
    expect((field('models') as HTMLTextAreaElement).value).toBe('m1\nm2');
  });

  it('把当前填的 key 一起带上，有些端点要鉴权才让列', async () => {
    const onListModels = vi.fn(async () => ['m1']);
    render({}, { onListModels });

    setValue(field('baseUrl'), 'https://relay.example/v1');
    setValue(field('key'), 'sk-1');
    await act(async () => {
      click(listButton());
    });

    expect(onListModels).toHaveBeenCalledWith('https://relay.example/v1', 'sk-1');
  });

  it('拉取失败时说明原因，并保留已经手填的内容', async () => {
    // 拉不到不该阻断流程——很多自建服务根本没实现 /models
    const onListModels = vi.fn(async () => {
      throw new Error('拉取模型列表失败（HTTP 404）');
    });
    render({}, { onListModels });

    setValue(field('baseUrl'), 'https://relay.example/v1');
    setValue(field('models'), '手填的模型');
    await act(async () => {
      click(listButton());
    });

    expect(text()).toContain('404');
    expect((field('models') as HTMLTextAreaElement).value).toBe('手填的模型');
  });

  it('地址为空时不发请求', () => {
    const onListModels = vi.fn(noopList);
    render({}, { onListModels });

    click(listButton());

    expect(onListModels).not.toHaveBeenCalled();
  });

  it('保存失败的原因显示出来', () => {
    render({ setupNotice: '不支持的 API 类型' });

    expect(text()).toContain('不支持的 API 类型');
  });
});
