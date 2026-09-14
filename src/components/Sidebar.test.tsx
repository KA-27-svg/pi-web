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
