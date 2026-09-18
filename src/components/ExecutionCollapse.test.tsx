// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ToolCallState } from '../types/pi';
import { ExecutionCollapse } from './ExecutionCollapse';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const render = (props: Partial<React.ComponentProps<typeof ExecutionCollapse>> = {}) => {
  act(() => {
    root.render(<ExecutionCollapse reasoning="想了一想" {...props} />);
  });
};

const header = () => host.querySelector('button') as HTMLButtonElement;
const click = () =>
  act(() => {
    header().dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
/** 展开时才会渲染「思考过程」这个标题 */
const expanded = () => (host.textContent ?? '').includes('思考过程');

const tool = (over: Partial<ToolCallState> = {}): ToolCallState => ({
  id: 't1',
  name: 'bash',
  args: { command: 'ls' },
  status: 'done',
  result: 'a.ts',
  ...over,
});

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('执行块的收缩', () => {
  it('默认收起，点一下展开', () => {
    render();

    expect(expanded()).toBe(false);
    click();
    expect(expanded()).toBe(true);
  });

  it('思考期间点开，回答一落地就自动收起，把回答内容让出来', () => {
    render({ isStreaming: true });
    click();
    expect(expanded()).toBe(true);

    // 这一轮结束
    render({ isStreaming: false });

    expect(expanded()).toBe(false);
  });

  it('回答结束后再点开就一直开着，不跟流式状态较劲', () => {
    render({ isStreaming: false });
    click();
    expect(expanded()).toBe(true);

    render({ isStreaming: false });
    expect(expanded()).toBe(true);
  });

  it('没点开过的话，流式结束也不会自己弹开', () => {
    render({ isStreaming: true });
    render({ isStreaming: false });
    expect(expanded()).toBe(false);
  });
});

describe('排版', () => {
  it('思考过程有高度上限，一长不会把整屏撑满', () => {
    render({ reasoning: '很长的一段思考\n'.repeat(200) });
    click();

    const box = host.querySelector('[data-reasoning]') as HTMLElement;
    expect(box.className).toContain('overflow-y-auto');
    expect(box.className).toMatch(/max-h-/);
  });

  it('多步操作时状态行给出步数', () => {
    render({ isStreaming: false, tools: [tool(), tool({ id: 't2', name: 'read' })] });

    expect(header().textContent).toContain('2 步操作');
  });
});

describe('思考 + 一步操作 ×5', () => {
  const fiveSteps = () =>
    Array.from({ length: 5 }, (_, i) =>
      tool({ id: `t${i}`, name: 'bash', args: { command: `echo ${i}` }, result: `结果 ${i}` })
    );

  it('收起时只占一行，写明 5 步', () => {
    render({ isStreaming: false, tools: fiveSteps(), reasoning: '想了五轮' });

    expect(expanded()).toBe(false);
    expect(header().textContent).toContain('思考');
    expect(header().textContent).toContain('5 步操作');
  });

  it('展开后是 5 行工具卡，思考过程仍然有高度上限', () => {
    render({ isStreaming: false, tools: fiveSteps(), reasoning: '想'.repeat(500) });
    click();

    expect(host.querySelectorAll('button[aria-expanded]')).toHaveLength(5);
    const box = host.querySelector('[data-reasoning]') as HTMLElement;
    expect(box.className).toMatch(/max-h-/);
    expect(box.className).toContain('overflow-y-auto');
  });

  it('思考期间展开这 5 步，回答落地后自动收起', () => {
    render({ isStreaming: true, tools: fiveSteps(), reasoning: '想了五轮' });
    click();
    expect(expanded()).toBe(true);

    render({ isStreaming: false, tools: fiveSteps(), reasoning: '想了五轮' });
    expect(expanded()).toBe(false);
  });
});
