// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { BridgeStatus, SessionSummary } from '../types/pi';
import { Sidebar } from './Sidebar';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 侧栏使用 hook 的默认松手延迟，这里等得宽松一些，不与具体默认值耦合
const WELL_AFTER_RELEASE = 1000;

const session = (index: number): SessionSummary => ({
  path: `/tmp/proj/session-${index}.jsonl`,
  id: `id-${index}`,
  preview: `对话 ${index}`,
  updatedAt: Date.now(),
  cwd: 'C:\\demo',
});

const status = (count: number, extra: Partial<BridgeStatus> = {}): BridgeStatus => ({
  connected: true,
  cwd: 'C:\\demo',
  isStreaming: false,
  sessions: Array.from({ length: count }, (_, i) => session(i)),
  ...extra,
});

const noop = () => {};

/** 新建 / 回收箱相关的回调，测试里大多用不到 */
const trashProps = {
  onRequestTrash: noop,
  onRestoreSession: noop,
  onPurgeSession: noop,
  onEmptyTrash: noop,
};

let root: Root;
let host: HTMLElement;

const mount = (count: number, overrides: Partial<React.ComponentProps<typeof Sidebar>> = {}) => {
  act(() => {
    root.render(
      <Sidebar
        open
        status={status(count)}
        onToggle={noop}
        onNewSession={noop}
        onOpenProviders={noop}
        onOpenCwd={noop}
        onSwitchSession={noop}
        onRenameSession={noop}
        onDeleteSession={noop}
        onRefreshSessions={noop}
        {...trashProps}
        {...overrides}
      />
    );
  });
};

const setMetrics = (
  el: HTMLElement,
  metrics: { scrollTop?: number; scrollHeight?: number; clientHeight?: number }
) => {
  for (const [key, value] of Object.entries(metrics)) {
    Object.defineProperty(el, key, { configurable: true, writable: true, value });
  }
};

const dispatchWheel = (target: EventTarget, deltaY: number) => {
  const event = new Event('wheel', { bubbles: true, cancelable: true }) as Event & {
    deltaY: number;
    deltaMode: number;
  };
  event.deltaY = deltaY;
  event.deltaMode = 0;
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

const nav = () => host.querySelector('nav') as HTMLElement;
/** 滚动内容的包裹层：橡皮筋的位移就加在它上面，而不是内层的 ul */
const list = () => host.querySelector('nav > div') as HTMLElement;
const listTransform = () => list().style.transform;
const rows = () => Array.from(host.querySelectorAll('nav li'));
const searchBox = () => host.querySelector('input[type="search"]') as HTMLInputElement;

/** 走 React 受控组件的正常路径改值 */
const typeQuery = (value: string) => {
  const el = searchBox();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const clickButton = (label: string) => {
  const button = Array.from(host.querySelectorAll('button')).find(
    b => (b.getAttribute('aria-label') ?? b.textContent ?? '').includes(label)
  );
  if (!button) throw new Error(`找不到按钮：${label}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  return button;
};

describe('历史对话侧栏', () => {
  it('滚动容器带常驻可见滚动条的样式类', () => {
    mount(3);
    expect(nav().className).toContain('scroll-visible');
  });

  it('隐藏时不渲染会话条目', () => {
    act(() => {
      root.render(
        <Sidebar
          open={false}
          status={status(3)}
          onToggle={noop}
          onNewSession={noop}
          onOpenProviders={noop}
          onOpenCwd={noop}
          onSwitchSession={noop}
          onRenameSession={noop}
          onDeleteSession={noop}
          onRefreshSessions={noop}
          {...trashProps}
        />
      );
    });
    expect(host.querySelector('aside')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('滚到列表底部后继续下滚会拉出位移并可回弹', () => {
    mount(20);
    setMetrics(nav(), { scrollTop: 400, scrollHeight: 900, clientHeight: 500 });

    const event = dispatchWheel(list(), 100);

    expect(event.defaultPrevented).toBe(true);
    expect(listTransform()).toMatch(/translateY\(-\d/);
  });

  it('列表未到底时不接管，交还原生滚动', () => {
    mount(20);
    setMetrics(nav(), { scrollTop: 100, scrollHeight: 900, clientHeight: 500 });

    const event = dispatchWheel(list(), 100);

    expect(event.defaultPrevented).toBe(false);
    expect(listTransform()).toBe('');
  });

  it('松手后回弹到原位', () => {
    vi.useFakeTimers();
    mount(20);
    setMetrics(nav(), { scrollTop: 400, scrollHeight: 900, clientHeight: 500 });

    dispatchWheel(list(), 100);
    expect(listTransform()).toMatch(/translateY\(-\d/);

    act(() => {
      vi.advanceTimersByTime(WELL_AFTER_RELEASE);
    });

    expect(listTransform()).toBe('translateY(0px)');
  });

  it('没有会话时完全不介入', () => {
    mount(0);
    setMetrics(nav(), { scrollTop: 0, scrollHeight: 500, clientHeight: 300 });

    const event = dispatchWheel(nav(), 100);

    expect(event.defaultPrevented).toBe(false);
  });
});

describe('搜索', () => {
  it('按标题过滤', () => {
    mount(0, { status: status(3, { sessions: [
      { path: '/a.jsonl', id: 'a', preview: '关于轨道的讨论', updatedAt: Date.now() },
      { path: '/b.jsonl', id: 'b', preview: '关于侧栏的讨论', updatedAt: Date.now() },
    ] }) });

    typeQuery('轨道');

    expect(rows()).toHaveLength(1);
    expect(host.textContent).toContain('关于轨道的讨论');
  });

  it('按项目名过滤', () => {
    mount(0, { status: status(2, { sessions: [
      { path: '/a.jsonl', id: 'a', preview: '甲', updatedAt: Date.now(), cwd: 'C:/work/alpha' },
      { path: '/b.jsonl', id: 'b', preview: '乙', updatedAt: Date.now(), cwd: 'C:/work/beta' },
    ] }) });

    typeQuery('alpha');

    expect(rows()).toHaveLength(1);
    expect(host.textContent).toContain('甲');
  });

  it('无匹配时给出明确文案而不是空白', () => {
    mount(2);

    typeQuery('不存在的东西');

    expect(rows()).toHaveLength(0);
    expect(host.textContent).toContain('没有匹配');
  });

  it('清空搜索后恢复全部', () => {
    mount(3);

    typeQuery('对话 1');
    expect(rows()).toHaveLength(1);

    clickButton('清空搜索');
    expect(rows()).toHaveLength(3);
  });
});

describe('删除与撤销', () => {
  it('删除后提示保留 30 天，并可一键撤销', () => {
    const onDeleteSession = vi.fn();
    const onRestoreSession = vi.fn();
    mount(2, { onDeleteSession, onRestoreSession });

    clickButton('删除');

    expect(onDeleteSession).toHaveBeenCalledWith('/tmp/proj/session-0.jsonl');
    expect(host.textContent).toContain('保留 30 天');

    clickButton('撤销');
    expect(onRestoreSession).toHaveBeenCalledWith('/tmp/proj/session-0.jsonl');
  });

  it('当前会话的删除按钮不可用', () => {
    mount(2, { status: status(2, { sessionId: 'id-0' }) });

    const deleteButtons = Array.from(host.querySelectorAll('button[aria-label="删除"]'));
    expect((deleteButtons[0] as HTMLButtonElement).disabled).toBe(true);
    expect((deleteButtons[1] as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('回收箱入口', () => {
  it('显示数量，点击切到回收箱并请求数据', () => {
    const onRequestTrash = vi.fn();
    mount(0, {
      onRequestTrash,
      status: status(0, {
        trashed: [
          { path: '/t1.jsonl', id: 't1', preview: '删掉的', deletedAt: Date.now(), expiresAt: Date.now() + 86400000 },
        ],
      }),
    });

    expect(host.textContent).toContain('回收箱');
    expect(host.textContent).toContain('(1)');

    clickButton('回收箱');
    expect(onRequestTrash).toHaveBeenCalled();
    // 切到回收箱视图：显示的是箱里的内容，而不是历史列表
    expect(host.textContent).toContain('删掉的');
    expect(host.textContent).toContain('天后清除');
  });
});

describe('列表被截断', () => {
  it('总数大于已展示条数时给出说明', () => {
    mount(0, { status: status(2, { sessionsTotal: 300 }) });

    expect(host.textContent).toContain('只显示最近 2 条');
    expect(host.textContent).toContain('300');
  });

  it('没被截断时不出提示', () => {
    mount(0, { status: status(2, { sessionsTotal: 2 }) });

    expect(host.textContent).not.toContain('只显示最近');
  });
});

describe('失败提示', () => {
  it('notice 以错误样式显示出来', () => {
    mount(2, { status: status(2, { notice: '无法打开该会话：目录不存在' }) });

    expect(host.textContent).toContain('无法打开该会话');
    const banner = host.querySelector('.text-rose-500');
    expect(banner).not.toBeNull();
  });

  it('可以关掉提示', () => {
    mount(2, { status: status(2, { notice: '出错了' }) });
    expect(host.textContent).toContain('出错了');

    clickButton('关闭提示');

    expect(host.textContent).not.toContain('出错了');
  });
});

describe('撤销契约', () => {
  it('撤销传的是原位置路径，桥接那侧必须接受这种入参', () => {
    // 这条断言锁住 UI 侧的契约：删除后客户端手上只有原位置路径，
    // 此刻还没拉过回收箱列表，拿不到箱内路径。
    // 对侧的接受能力由 server/trash.test.ts 的
    // 「用原位置路径也能恢复」兜着——两边必须同时成立。
    const onRestoreSession = vi.fn();
    mount(2, { onRestoreSession });

    clickButton('删除');
    clickButton('撤销');

    expect(onRestoreSession).toHaveBeenCalledWith('/tmp/proj/session-0.jsonl');
  });
});

describe('侧栏顶部动作', () => {
  const action = (label: string) =>
    [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label);

  const clickAction = (label: string) =>
    act(() => {
      action(label)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

  it('三个条目长得一样：一个图标加几个字', () => {
    mount(0);

    // 只有图标和文字，没有副标题、没有摘要——堆了就不叫「简单」了
    for (const label of ['新建对话', '模型供应商', '工作目录']) {
      const button = action(label);
      expect(button, label).toBeTruthy();
      expect(button?.querySelector('svg'), label).toBeTruthy();
      expect(button?.textContent?.trim(), label).toBe(label);
    }
  });

  it('模型供应商和工作目录都是从侧栏打开的', () => {
    // 这两项以前挤在设置下拉里，跟模型、思考强度、花费、环境自检堆在一起
    const onOpenProviders = vi.fn();
    const onOpenCwd = vi.fn();
    mount(0, { onOpenProviders, onOpenCwd });

    clickAction('模型供应商');
    expect(onOpenProviders).toHaveBeenCalledTimes(1);

    clickAction('工作目录');
    expect(onOpenCwd).toHaveBeenCalledTimes(1);
  });

  it('新建对话仍然照旧', () => {
    const onNewSession = vi.fn();
    mount(0, { onNewSession });

    clickAction('新建对话');

    expect(onNewSession).toHaveBeenCalledTimes(1);
  });
});

describe('侧栏刷新按钮的点击反馈', () => {
  const refreshButton = () =>
    host.querySelector('button[aria-label="刷新历史对话"]') as HTMLButtonElement;

  const clickRefresh = () =>
    act(() => {
      refreshButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

  it('点下去立刻转圈、按钮禁用，不让用户猜点上没有', () => {
    // 以前点了什么都不变：列表没变就重渲染成同一幅画面
    const onRefreshSessions = vi.fn();
    mount(3, { onRefreshSessions });

    clickRefresh();

    expect(onRefreshSessions).toHaveBeenCalledTimes(1);
    expect(refreshButton().disabled).toBe(true);
    expect(host.querySelector('.animate-spin')).toBeTruthy();
  });

  it('数据回来（换了新数组）后换成对勾', () => {
    mount(3);
    clickRefresh();

    // 桥接那边每次都是 `sessions: data.sessions ?? []`，必然是新数组
    mount(3);

    expect(host.querySelector('.animate-spin')).toBeNull();
    expect(refreshButton().title).toBe('已刷新');
  });

  it('对勾停一下就回到原样，不会一直留着', () => {
    vi.useFakeTimers();
    try {
      mount(3);
      clickRefresh();
      mount(3);
      expect(refreshButton().title).toBe('已刷新');

      act(() => {
        vi.advanceTimersByTime(1300);
      });

      expect(refreshButton().title).toBe('刷新');
    } finally {
      vi.useRealTimers();
    }
  });

  it('请求一直没回来也会把转圈停掉，而不是永远转下去', () => {
    vi.useFakeTimers();
    try {
      mount(3);
      clickRefresh();
      expect(host.querySelector('.animate-spin')).toBeTruthy();

      // 不换数组，相当于一个包都没回
      act(() => {
        vi.advanceTimersByTime(8100);
      });

      expect(host.querySelector('.animate-spin')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
