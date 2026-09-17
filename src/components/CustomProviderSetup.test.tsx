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
const retryButton = () =>
  [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === '再试一次') as
    | HTMLButtonElement
    | undefined;
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

/** 填好那三样 */
const fill = (over: Record<string, string> = {}) => {
  setValue(field('label')!, over.label ?? '我的中转站');
  setValue(field('baseUrl')!, over.baseUrl ?? 'https://relay.example/v1');
  setValue(field('key')!, over.key ?? 'sk-1');
};

const submit = () =>
  act(async () => {
    click(saveButton());
  });

describe('CustomProviderSetup 平时只有三样', () => {
  it('可见的就三个输入，没有折叠区要展开', () => {
    render();

    expect(field('label')).toBeTruthy();
    expect(field('baseUrl')).toBeTruthy();
    expect(field('key')).toBeTruthy();

    // 这些平时都不该出现，也不该有个「高级」要用户去点
    expect(field('api')).toBeNull();
    expect(field('models')).toBeNull();
    expect(field('id')).toBeNull();
    expect(text()).not.toContain('高级');
  });

  it('显示名、地址、密钥三个都得填', () => {
    render();

    expect(saveButton().disabled).toBe(true);

    setValue(field('label')!, '我的中转站');
    expect(saveButton().disabled).toBe(true);

    setValue(field('baseUrl')!, 'https://relay.example/v1');
    // 密钥不能省：pi 没配鉴权时模型会加载但在 /model 里始终不可用，
    // 存一个没密钥的供应商等于存了个选不了的
    expect(saveButton().disabled).toBe(true);

    setValue(field('key')!, 'sk-1');
    expect(saveButton().disabled).toBe(false);
  });

  it('只有空白字符不算填了密钥', () => {
    render();

    fill();
    setValue(field('key')!, '   ');

    expect(saveButton().disabled).toBe(true);
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

    fill({ key: 'sk-real' });
    await submit();

    expect(onListModels).toHaveBeenCalledWith('https://relay.example/v1', 'sk-real');
    expect(onSave).toHaveBeenCalledWith({
      // 标识从地址的域名推，不暴露给用户
      id: 'relay.example',
      label: '我的中转站',
      baseUrl: 'https://relay.example/v1',
      api: 'openai-completions',
      models: ['gpt-x', 'claude-y'],
      key: 'sk-real',
    });
  });

  it('拉不到时把 API 类型和模型 id 就地摊出来，不用用户去找', async () => {
    // 很多自建服务根本没实现 /models
    const onListModels = vi.fn(async () => {
      throw new Error('拉取模型列表失败（HTTP 404）');
    });
    const onSave = vi.fn();
    render({}, { onListModels, onSave });

    expect(field('models')).toBeNull();

    fill();
    await submit();

    expect(onSave).not.toHaveBeenCalled();
    expect(text()).toContain('404');
    expect(field('models')).toBeTruthy();
    expect(field('api')).toBeTruthy();
  });

  it('摊出来之后再填上模型就能存', async () => {
    const onListModels = vi.fn(async () => {
      throw new Error('拉取模型列表失败（HTTP 404）');
    });
    const onSave = vi.fn();
    render({}, { onListModels, onSave });

    fill();
    await submit();

    setValue(field('models')!, ' 本地模型 A \n\n本地模型 B ');
    await submit();

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ models: ['本地模型 A', '本地模型 B'] })
    );
  });

  it('拉到空列表也算失败：pi 那边一个模型都没有，存了也是空的', async () => {
    const onSave = vi.fn();
    render({}, { onListModels: vi.fn(async () => []), onSave });

    fill();
    await submit();

    expect(onSave).not.toHaveBeenCalled();
    expect(text()).toContain('没返回任何模型');
    expect(field('models')).toBeTruthy();
  });

  it('正在拉取时按钮说清楚在干什么', async () => {
    let release: (ids: string[]) => void = () => {};
    const onListModels = vi.fn(
      () =>
        new Promise<string[]>(resolve => {
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

  it('摊出来那块里可以把拉取再试一次', async () => {
    const onListModels = vi
      .fn<(b: string, k: string) => Promise<string[]>>()
      .mockRejectedValueOnce(new Error('拉取模型列表失败（HTTP 404）'))
      .mockResolvedValueOnce(['m1', 'm2']);
    render({}, { onListModels });

    fill();
    await submit();
    expect(retryButton()).toBeTruthy();

    await act(async () => {
      click(retryButton());
    });

    expect((field('models') as HTMLTextAreaElement).value).toBe('m1\nm2');
  });
});

describe('CustomProviderSetup API 类型', () => {
  it('默认 openai-completions，摊出来时列出 pi 支持的四种', async () => {
    render({}, {
      onListModels: vi.fn(async () => {
        throw new Error('拉取模型列表失败（HTTP 404）');
      }),
    });

    fill();
    await submit();

    const select = field('api') as HTMLSelectElement;
    expect(select.value).toBe('openai-completions');
    expect([...select.querySelectorAll('option')].map(o => o.value)).toEqual([
      'openai-completions',
      'openai-responses',
      'anthropic-messages',
      'google-generative-ai',
    ]);
  });

  it('改了类型之后提交的是改过的那个', async () => {
    const onSave = vi.fn();
    render(
      {},
      {
        onListModels: vi.fn(async () => {
          throw new Error('拉取模型列表失败（HTTP 404）');
        }),
        onSave,
      }
    );

    fill();
    await submit();

    setValue(field('api')!, 'anthropic-messages');
    setValue(field('models')!, 'claude-y');
    await submit();

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ api: 'anthropic-messages' }));
  });
});
