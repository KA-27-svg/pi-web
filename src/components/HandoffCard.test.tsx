// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HandoffCard } from './HandoffCard';
import { MarkdownView } from './MarkdownView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const render = (node: React.ReactNode) => {
  act(() => {
    root.render(node);
  });
};

const text = () => host.textContent ?? '';
const button = (label: string) =>
  [...host.querySelectorAll('button')].find(item => (item.textContent ?? '').includes(label)) as
    | HTMLButtonElement
    | undefined;

const click = (element: HTMLElement | undefined) => {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('结论卡片', () => {
  const plan = '# 加个开关\n\n先做 A，再做 B。';

  it('把结论渲染出来，并给出两个投递方式', () => {
    render(<HandoffCard text={plan} onDeliver={vi.fn()} />);

    expect(text()).toContain('交给执行窗口');
    expect(text()).toContain('加个开关');
    expect(text()).toContain('先做 A');
    expect(button('存为计划并投递')).toBeDefined();
    expect(button('直接投递')).toBeDefined();
  });

  it('「存为计划并投递」走 file，并把结果告诉用户', async () => {
    const onDeliver = vi.fn().mockResolvedValue('已存为 docs/plans/x.md，并投递给执行窗口');
    render(<HandoffCard text={plan} onDeliver={onDeliver} />);

    await act(async () => {
      click(button('存为计划并投递'));
    });

    expect(onDeliver).toHaveBeenCalledWith(plan, 'file');
    expect(text()).toContain('已存为 docs/plans/x.md');
  });

  it('「直接投递」走 text', async () => {
    const onDeliver = vi.fn().mockResolvedValue('已投递给执行窗口');
    render(<HandoffCard text={plan} onDeliver={onDeliver} />);

    await act(async () => {
      click(button('直接投递'));
    });

    expect(onDeliver).toHaveBeenCalledWith(plan, 'text');
  });

  it('可以在发送前改一改，投出去的是改过的内容', async () => {
    const onDeliver = vi.fn().mockResolvedValue('好了');
    render(<HandoffCard text={plan} onDeliver={onDeliver} />);

    click(button('编辑'));
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe(plan);

    act(() => {
      // React 的 onChange 靠 value 的 setter 触发
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '改过的计划');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await act(async () => {
      click(button('存为计划并投递'));
    });

    expect(onDeliver).toHaveBeenCalledWith('改过的计划', 'file');
  });

  it('失败时把原因显示在卡片上，而不是静默', async () => {
    const onDeliver = vi.fn().mockRejectedValue(new Error('计划内容为空'));
    render(<HandoffCard text={plan} onDeliver={onDeliver} />);

    await act(async () => {
      click(button('存为计划并投递'));
    });

    expect(text()).toContain('计划内容为空');
  });

  it('改成空白之后按钮禁用（不发一条空消息过去）', async () => {
    const onDeliver = vi.fn();
    render(<HandoffCard text={plan} onDeliver={onDeliver} />);

    click(button('编辑'));
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      setter?.call(textarea, '   ');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(button('存为计划并投递')?.disabled).toBe(true);
    expect(button('直接投递')?.disabled).toBe(true);
  });
});

describe('markdown 里的 handoff 围栏块', () => {
  const deliver = vi.fn().mockResolvedValue('好了');

  it('带 onHandoff 时渲染成卡片', () => {
    render(<MarkdownView content={'先聊聊。\n\n```handoff\n做 A\n```\n'} onHandoff={deliver} />);

    expect(host.querySelector('[data-handoff-card]')).not.toBeNull();
    expect(text()).toContain('做 A');
    expect(text()).toContain('存为计划并投递');
  });

  it('流式期间还没闭合也已经是卡片（CommonMark 的未闭合围栏一直延到结尾）', () => {
    render(<MarkdownView content={'```handoff\n正在写结论'} onHandoff={deliver} />);

    expect(host.querySelector('[data-handoff-card]')).not.toBeNull();
    expect(text()).toContain('正在写结论');
  });

  it('别的语言仍然是代码块', () => {
    render(<MarkdownView content={'```ts\nconst a = 1;\n```'} onHandoff={deliver} />);

    expect(host.querySelector('[data-handoff-card]')).toBeNull();
    expect(text()).toContain('const a = 1;');
  });

  it('没传 onHandoff（执行窗口自己）时就是普通代码块', () => {
    render(<MarkdownView content={'```handoff\n做 A\n```'} />);

    expect(host.querySelector('[data-handoff-card]')).toBeNull();
    expect(text()).toContain('做 A');
  });
});
