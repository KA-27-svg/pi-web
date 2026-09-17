// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, CustomProviderDraft } from '../types/pi';
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

const render = (
  extra: Partial<BridgeStatus> = {},
  handlers: {
    onListModels?: (b: string, k: string) => Promise<string[]>;
    onSave?: (d: CustomProviderDraft) => void;
  } = {}
) => {
  const onListModels = handlers.onListModels ?? vi.fn(async () => [] as string[]);
  const onSave = handlers.onSave ?? vi.fn();

  act(() => {
    root.render(
      <CustomProviderSetup status={status(extra)} onListModels={onListModels} onSave={onSave} />
    );
  });

  return { onListModels, onSave };
};

const field = (name: string) =>
  host.querySelector(`[data-field="${name}"]`) as
    | HTMLInputElement
    | HTMLTextAreaElement
    | HTMLSelectElement
    | null;
const saveButton = () => host.querySelector('button[type="submit"]') as HTMLButtonElement;
const advancedToggle = () =>
  [...host.querySelectorAll('button')].find(b => b.textContent?.includes('高级')) as HTMLButtonElement;
const pullButton = () =>
  [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === '拉取') as HTMLButtonElement;
const text = () => host.textContent ?? '';

function setValue(el: Element, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement
        : HTMLInputElement;
  Object.getOwnPropertyDescriptor(proto.prototype, 'value')?.set?.call(el, value);
  act(() => {
    el.dispatchEvent(
      new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })
    );
  });
}

const click = (el: Element | null | undefined) => {
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

/** 填好那三样，需要时展开高级 */
const fill = (over: Record<string, string> = {}, advanced = false) => {
  setValue(field('label')!, over.label ?? '我的中转站');
  setValue(field('baseUrl')!, over.baseUrl ?? 'https://relay.example/v1');
  if (over.key) setValue(field('key')!, over.key);
  if (advanced) {
    click(advancedToggle());
    if (over.models) setValue(field('models')!, over.models);
    if (over.id) setValue(field('id')!, over.id);
  }
};

const submit = () =>
  act(async () => {
    click(saveButton());
  });

describe('CustomProviderSetup 只让填三样', () => {
  it('可见的就三个输入：显示名、地址、密钥', () => {
    render();

    expect(field('label')).toBeTruthy();
    expect(field('baseUrl')).toBeTruthy();
    expect(field('key')).toBeTruthy();

    // 其余全在「高级」里，默认不渲染
    expect(field('id')).toBeNull();
    expect(field('api')).toBeNull();
    expect(field('models')).toBeNull();
  });

  it('高级里才是标识、API 类型、模型列表', () => {
    render();
    click(advancedToggle());

    expect(field('id')).toBeTruthy();
    expect(field('api')).toBeTruthy();
    expect(field('models')).toBeTruthy();
  });

  it('显示名或地址没填就不能保存', () => {
    render();

    expect(saveButton().disabled).toBe(true);

    setValue(field('label')!, '我的中转站');
    expect(saveButton().disabled).toBe(true);

    setValue(field('baseUrl')!, 'https://relay.example/v1');
    expect(saveButton().disabled).toBe(false);
  });

  it('密钥可以不填：本地服务常常不需要', async () => {
    const onSave = vi.fn();
    render({}, { onListModels: vi.fn(async () => ['m1']), onSave });

    fill();
    await submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ label: '我的中转站', key: '' })
    );
  });

  it('密钥输入框是密码类型', () => {
    render();

    expect(field('key')!.getAttribute('type')).toBe('password');
  });

  it('保存失败的原因显示出来', () => {
    render({ setupNotice: '不支持的 API 类型' });

    expect(text()).toContain('不支持的 API 类型');
  });
});

describe('CustomProviderSetup 保存时自动拉模型', () => {
  it('没手填模型就去拉，拉到了直接存', async () => {
    // 这是这次改动的核心：用户不用知道「模型 id 每行一个」这回事
    const onListModels = vi.fn(async () => ['gpt-x', 'claude-y']);
    const onSave = vi.fn();
    render({}, { onListModels, onSave });

    fill({ key: 'sk-1' });
    await submit();

    expect(onListModels).toHaveBeenCalledWith('https://relay.example/v1', 'sk-1');
    expect(onSave).toHaveBeenCalledWith({
      id: 'relay.example',
      label: '我的中转站',
      baseUrl: 'https://relay.example/v1',
      api: 'openai-completions',
      models: ['gpt-x', 'claude-y'],
      key: 'sk-1',
    });
  });

  it('手填过模型就直接存，不再打扰网络', async () => {
    const onListModels = vi.fn(async () => ['不该被用到']);
    const onSave = vi.fn();
    render({}, { onListModels, onSave });

    fill({ models: ' 本地模型 A \n\n 本地模型 B ' }, true);
    await submit();

    expect(onListModels).not.toHaveBeenCalled();
    expect(onSave.mock.calls[0][0].models).toEqual(['本地模型 A', '本地模型 B']);
  });

  it('拉不到时展开高级并说明原因，而不是默默失败', async () => {
    // 很多自建服务根本没实现 /models
    const onListModels = vi.fn(async () => {
      throw new Error('拉取模型列表失败（HTTP 404）');
    });
    const onSave = vi.fn();
    render({}, { onListModels, onSave });

    fill();
    await submit();

    expect(onSave).not.toHaveBeenCalled();
    expect(text()).toContain('404');
    expect(field('models')).toBeTruthy(); // 高级被自动展开了
  });

  it('拉到空列表也算失败：pi 那边一个模型都没有，存了也是空的', async () => {
    const onSave = vi.fn();
    render({}, { onListModels: vi.fn(async () => []), onSave });

    fill();
    await submit();

    expect(onSave).not.toHaveBeenCalled();
    expect(text()).toContain('没返回任何模型');
  });

  it('正在拉取时按钮说清楚在干什么', async () => {
    let release: (ids: string[]) => void = () => {};
    const onListModels = vi.fn(
      () => new Promise<string[]>(resolve => {
        release = resolve;
      })
    );
    render({}, { onListModels });

    fill();
    await act(async () => {
      click(saveButton());
    });

    expect(saveButton().textContent).toContain('正在拉取模型');
    expect(saveButton().disabled).toBe(true);

    await act(async () => {
      release(['m1']);
    });
  });
});

describe('CustomProviderSetup 标识推导', () => {
  it('标识在高级里、跟着地址变，也可以自己改', () => {
    render();

    click(advancedToggle());
    expect((field('id') as HTMLInputElement).value).toBe('relay');

    setValue(field('baseUrl')!, 'https://relay.example/v1');
    expect((field('id') as HTMLInputElement).value).toBe('relay.example');

    setValue(field('id')!, 'my-own-id');
    setValue(field('baseUrl')!, 'https://other.example/v1');
    // 用户改过就不再跟着变了
    expect((field('id') as HTMLInputElement).value).toBe('my-own-id');
  });

  it('API 类型默认 openai-completions，并列出 pi 支持的四种', () => {
    render();
    click(advancedToggle());

    const select = field('api') as HTMLSelectElement;
    expect(select.value).toBe('openai-completions');
    expect([...select.querySelectorAll('option')].map(o => o.value)).toEqual([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ]);
  });
});

describe('CustomProviderSetup 手动拉取', () => {
  it('把拉回来的模型填进输入框', async () => {
    const onListModels = vi.fn(async () => ['m1', 'm2']);
    render({}, { onListModels });

    setValue(field('baseUrl')!, 'https://relay.example/v1');
    click(advancedToggle());
    await act(async () => {
      click(pullButton());
    });

    expect((field('models') as HTMLTextAreaElement).value).toBe('m1\nm2');
  });

  it('把当前填的 key 一起带上，有些端点要鉴权才让列', async () => {
    const onListModels = vi.fn(async () => ['m1']);
    render({}, { onListModels });

    setValue(field('baseUrl')!, 'https://relay.example/v1');
    setValue(field('key')!, 'sk-1');
    click(advancedToggle());
    await act(async () => {
      click(pullButton());
    });

    expect(onListModels).toHaveBeenCalledWith('https://relay.example/v1', 'sk-1');
  });
});
