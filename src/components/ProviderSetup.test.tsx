// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type {
  BridgeStatus,
  EndpointModelsProbe,
  ProviderPreset,
  SetupStatus,
} from '../types/pi';
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

const render = (
  extra: Partial<BridgeStatus> = {},
  onSave = vi.fn(),
  onSaved = vi.fn()
) => {
  act(() => {
    root.render(
      <ProviderSetup status={status(extra)} onSave={onSave} onSaved={onSaved} />
    );
  });
  return onSave;
};

const select = () => host.querySelector('select') as HTMLSelectElement;
const keyInput = () => host.querySelector('input[type="password"]') as HTMLInputElement;
const baseUrlInput = () =>
  host.querySelector('[data-field="baseUrl"]') as HTMLInputElement;
const nameInput = () => host.querySelector('[data-field="name"]') as HTMLInputElement;
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

  it('订阅登录专用的供应商不出现在贴 key 的下拉里', () => {
    // github-copilot 只认 OAuth，贴一个 api_key 写进 auth.json 语义就是错的
    render({
      providers: [
        ...PROVIDERS,
        { id: 'github-copilot', label: 'GitHub Copilot', envVar: '', subscriptionOnly: true },
      ],
    });

    const values = [...select().querySelectorAll('option')].map(o => o.value);
    expect(values).toEqual(['anthropic', 'deepseek']);
    expect(values).not.toContain('github-copilot');
  });

  it('填了 key 才能提交', () => {
    const onSave = render();

    expect(submitButton().disabled).toBe(true);

    setValue(keyInput(), 'sk-ant-1');
    expect(submitButton().disabled).toBe(false);

    submit();
    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1', undefined, undefined);
  });

  it('已配过的供应商留空密钥也能提交（只改名字 / 地址）', () => {
    const onSave = render({
      setup: { credentials: { providers: ['anthropic'] } } as SetupStatus,
    });

    // 密钥不回显，要求重填等于让用户把它翻出来重贴一遍
    expect(submitButton().disabled).toBe(false);

    setValue(nameInput(), '公司账号');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', '', undefined, '公司账号');
  });

  it('回显已有中转地址，换密钥时不会把它丢掉', () => {
    const onSave = render({
      setup: { credentials: { providers: ['deepseek'] } } as SetupStatus,
      providerBaseUrls: { deepseek: 'https://relay.example/v1' },
    });

    setValue(select(), 'deepseek');
    // 不回显的话，用户只想换 key 就会把地址一起提交没了
    expect(baseUrlInput().value).toBe('https://relay.example/v1');

    setValue(keyInput(), 'sk-new');
    submit();

    expect(onSave).toHaveBeenCalledWith(
      'deepseek',
      'sk-new',
      'https://relay.example/v1',
      undefined
    );
  });

  it('换供应商时清掉刚填的密钥，不会把 A 的 key 存到 B 名下', () => {
    render();

    setValue(keyInput(), 'sk-anthropic');
    setValue(select(), 'deepseek');

    expect(keyInput().value).toBe('');
    expect(submitButton().disabled).toBe(true);
  });

  it('换成另一个供应商后，提交用它', () => {
    const onSave = render();

    setValue(select(), 'deepseek');
    setValue(keyInput(), 'sk-ds-1');
    submit();

    expect(onSave).toHaveBeenCalledWith('deepseek', 'sk-ds-1', undefined, undefined);
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

  it('地址是可填可不填的：留空时提交不带第三个参数', () => {
    // 不填 = 用该供应商的官方地址。这是常态，所以不能强制填
    const onSave = render();

    setValue(keyInput(), 'sk-ant-1');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1', undefined, undefined);
  });

  it('填了地址就把它一起带上（走中转站）', () => {
    // pi 官方对中转站的做法：不重定义模型，只把请求发到那个地址，
    // 所以这里不需要模型列表、也不需要 API 类型
    const onSave = render();

    setValue(keyInput(), 'sk-ant-1');
    setValue(baseUrlInput(), 'https://relay.example/v1');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1', 'https://relay.example/v1', undefined);
  });

  it('地址两端空白不会被当成填了', () => {
    const onSave = render();

    setValue(keyInput(), 'sk-ant-1');
    setValue(baseUrlInput(), '   ');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1', undefined, undefined);
  });

  it('名字留空就用官方名字（提交 undefined，不是空串）', () => {
    const onSave = render();

    setValue(keyInput(), 'sk-ant-1');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1', undefined, undefined);
  });

  it('起了名字就一起带上', () => {
    const onSave = render();

    setValue(keyInput(), 'sk-ant-1');
    setValue(nameInput(), '我的中转站');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1', undefined, '我的中转站');
  });

  it('已经起过名的供应商，打开表单就带着那个名字', () => {
    // 不带着的话，用户下次只是换个 key 就会把名字清掉
    render({ providerNames: { anthropic: '公司账号' } });

    expect(nameInput().value).toBe('公司账号');
  });

  it('把名字改空、提交，就是让它退回官方名字', () => {
    const onSave = render({ providerNames: { anthropic: '公司账号' } });

    setValue(keyInput(), 'sk-ant-1');
    setValue(nameInput(), '');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-ant-1', undefined, undefined);
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

  it('过一会儿回到原来的文案，不会一直挂着「已保存」', () => {    vi.useFakeTimers();
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

  it('存好了会通知外面一声（弹窗靠它关掉、外面靠它报成功）', () => {
    vi.useFakeTimers();
    try {
      const onSaved = vi.fn();
      render({ setup: setup() }, vi.fn(), onSaved);
      setValue(keyInput(), 'sk-1');
      submit();

      // 回包还没到，不能报成功
      expect(onSaved).not.toHaveBeenCalled();

      render({ setup: setup() }, vi.fn(), onSaved);
      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(onSaved).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('中转端点（同一上游的第二个入口）', () => {
  it('已配的中转端点出现在下拉里，用显示名', () => {
    render({
      providerNames: { 'deepseek-relay': 'DeepSeek 中转' },
      setup: {
        ready: true,
        credentials: { providers: ['deepseek', 'deepseek-relay'], hasAny: true },
      },
    } as unknown as Partial<BridgeStatus>);

    const groups = [...select().querySelectorAll('optgroup')];
    expect(groups.map(g => g.label)).toEqual(['官方入口', '已配的中转端点']);
    expect(groups[1].querySelector('option')?.textContent).toBe('DeepSeek 中转');
  });

  it('填了地址：按独立端点保存（带 newEndpoint），名称缺省不发（桥接用官方名兜底）', () => {
    const onSave = render();
    setValue(select(), 'deepseek');
    setValue(keyInput(), 'sk-relay');
    setValue(baseUrlInput(), 'https://relay.example/v1');
    submit();

    expect(onSave).toHaveBeenCalledWith('deepseek', 'sk-relay', 'https://relay.example/v1', undefined);
    expect(text()).toContain('独立的中转端点');
  });

  it('地址留空：配的是官方入口，不带 newEndpoint', () => {
    const onSave = render();
    setValue(select(), 'deepseek');
    setValue(keyInput(), 'sk-official');
    submit();

    expect(onSave).toHaveBeenCalledWith('deepseek', 'sk-official', undefined, undefined);
  });

  it('选中已配的端点后可以只改名，密钥留空', () => {
    const onSave = render({
      providerNames: { 'deepseek-relay': 'DeepSeek 中转' },
      providerBaseUrls: { 'deepseek-relay': 'https://relay.example/v1' },
      setup: {
        ready: true,
        credentials: { providers: ['deepseek', 'deepseek-relay'], hasAny: true },
      },
    } as unknown as Partial<BridgeStatus>);

    setValue(select(), 'deepseek-relay');
    // 地址回显（不然只换 key 会在空地址上提交，把中转地址覆盖掉）
    expect(baseUrlInput().value).toBe('https://relay.example/v1');
    setValue(nameInput(), '改名后的中转');
    submit();

    expect(onSave).toHaveBeenCalledWith(
      'deepseek-relay',
      '',
      'https://relay.example/v1',
      '改名后的中转'
    );
  });
});

describe('ProviderSetup：中转端点分两步（探测 → 勾选 → 保存）', () => {
  /** 真实案例的形状：一个「DeepSeek」分组里混着别的厂商 */
  const probe = {
    provider: 'deepseek',
    upstream: 'deepseek',
    from: 'upstream' as const,
    models: [
      { id: 'deepseek-v4-flash', recommended: true },
      { id: 'deepseek-v4-pro', recommended: true },
      { id: 'deepseek-v4.1-flash', recommended: true },
      { id: 'glm-5.3', recommended: false },
      { id: 'kimi-k3', recommended: false },
    ],
  };

  const renderWithProbe = (
    onProbe: (provider: string, key: string, baseUrl: string) => Promise<EndpointModelsProbe> =
      vi.fn(async () => probe),
    onSave = vi.fn()
  ) => {
    act(() => {
      root.render(
        <ProviderSetup status={status()} onSave={onSave} onProbe={onProbe} onSaved={vi.fn()} />
      );
    });
    return { onProbe, onSave };
  };

  const checkboxes = () => [...host.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
  const check = (id: string, on: boolean) => {
    const box = checkboxes().find(
      el => el.closest('label')?.textContent?.includes(id)
    ) as HTMLInputElement;
    if (box.checked !== on) act(() => box.click());
  };
  const fillEndpoint = () => {
    setValue(keyInput(), 'sk-relay');
    setValue(baseUrlInput(), 'https://api-slb.micuapi.ai/v1');
  };

  it('填了地址先探测，不直接保存', async () => {
    const { onProbe, onSave } = renderWithProbe();

    fillEndpoint();
    await act(async () => submit());

    expect(onProbe).toHaveBeenCalledWith(
      'anthropic',
      'sk-relay',
      'https://api-slb.micuapi.ai/v1'
    );
    expect(onSave).not.toHaveBeenCalled();
    // 列出来的就是上游报的那些
    expect(checkboxes()).toHaveLength(5);
    expect(text()).toContain('上游报了 5 个模型');
  });

  it('默认只勾该上游自己的，别的厂商列出来但不勾', async () => {
    renderWithProbe();

    fillEndpoint();
    await act(async () => submit());

    const checkedIds = checkboxes()
      .filter(box => box.checked)
      .map(box => box.closest('label')?.textContent?.trim());
    expect(checkedIds).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash']);
    expect(text()).toContain('同一个分组里的其它厂商');
  });

  it('确认后只把勾中的交上去', async () => {
    const { onSave } = renderWithProbe();

    fillEndpoint();
    await act(async () => submit());
    // 再勾一个别的厂商的
    check('glm-5.3', true);
    await act(async () => submit());

    expect(onSave).toHaveBeenCalledWith(
      'anthropic',
      'sk-relay',
      'https://api-slb.micuapi.ai/v1',
      undefined,
      ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash', 'glm-5.3']
    );
  });

  it('一个都不勾就不让保存（建出空清单的端点，界面上看不见）', async () => {
    renderWithProbe();

    fillEndpoint();
    await act(async () => submit());
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro', 'deepseek-v4.1-flash']) {
      check(id, false);
    }

    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toContain('0 个模型');
  });

  it('「全选」把上游的模型全勾上', async () => {
    renderWithProbe();

    fillEndpoint();
    await act(async () => submit());
    const selectAll = [...host.querySelectorAll('button')].find(
      button => button.textContent === '全选'
    ) as HTMLButtonElement;
    act(() => selectAll.click());

    expect(checkboxes().every(box => box.checked)).toBe(true);
    expect(submitButton().textContent).toContain('5 个模型');
  });

  it('地址一改，探测结果作废（不能拿 A 的清单存给 B）', async () => {
    renderWithProbe();

    fillEndpoint();
    await act(async () => submit());
    expect(checkboxes()).toHaveLength(5);

    setValue(baseUrlInput(), 'https://别的中转/v1');

    expect(checkboxes()).toHaveLength(0);
    expect(submitButton().textContent).toContain('选择模型');
  });

  it('探测失败：把原因说出来，不静默', async () => {
    renderWithProbe(vi.fn(async () => Promise.reject(new Error('中转地址必须是 http(s) 链接'))));

    fillEndpoint();
    await act(async () => submit());

    expect(text()).toContain('中转地址必须是 http(s) 链接');
  });

  it('上游没给清单时用内置目录兜底，并说明来源', async () => {
    renderWithProbe(
      vi.fn(async () => ({
        provider: 'deepseek',
        upstream: 'deepseek',
        from: 'catalog' as const,
        models: [{ id: 'deepseek-v4-pro', recommended: true }],
      }))
    );

    fillEndpoint();
    await act(async () => submit());

    expect(text()).toContain('上游没给清单，改用 pi 内置目录');
    expect(checkboxes()[0].checked).toBe(true);
  });

  it('没填地址时还是一步到位（官方入口）', async () => {
    const onSave = vi.fn();
    renderWithProbe(vi.fn(async () => probe), onSave);

    setValue(keyInput(), 'sk-official');
    submit();

    expect(onSave).toHaveBeenCalledWith('anthropic', 'sk-official', undefined, undefined);
  });
});
