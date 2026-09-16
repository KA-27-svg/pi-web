// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatInput } from './ChatInput';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const textarea = () => host.querySelector('textarea') as HTMLTextAreaElement;
const byLabel = (label: string) =>
  host.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

const mount = (props: Partial<React.ComponentProps<typeof ChatInput>> = {}) => {
  act(() => {
    root.render(<ChatInput onSend={() => {}} onStop={() => {}} isLoading={false} {...props} />);
  });
};

/** 走 React 受控组件的正常路径改值 */
const type = (value: string) => {
  const el = textarea();
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('生成中排队发送', () => {
  it('输入为空时只剩「中断」，不给一个点了没反应的按钮', () => {
    mount({ isLoading: true });

    expect(byLabel('中断')).not.toBeNull();
    expect(byLabel('排队发送')).toBeNull();
  });

  it('有内容时出现「排队发送」', () => {
    mount({ isLoading: true });
    type('顺便改成 useMemo');

    expect(byLabel('排队发送')).not.toBeNull();
  });

  it('点击「排队发送」把 queue 交给上层，并清空输入', () => {
    const calls: Array<{ options?: { queue?: boolean } }> = [];
    mount({
      isLoading: true,
      onSend: (_draft, options) => calls.push({ options }),
    });
    type('顺便改成 useMemo');

    act(() => byLabel('排队发送')!.click());

    expect(calls).toHaveLength(1);
    expect(calls[0].options).toEqual({ queue: true });
    expect(textarea().value).toBe('');
  });

  it('不在生成中时走普通发送，queue 为 false', () => {
    const calls: Array<{ options?: { queue?: boolean } }> = [];
    mount({
      isLoading: false,
      onSend: (_draft, options) => calls.push({ options }),
    });
    type('普通消息');

    act(() => byLabel('发送')!.click());

    expect(calls[0].options).toEqual({ queue: false });
  });

  it('「中断」触发 onStop（上层会去清队列、收回消息）', () => {
    let interrupted = 0;
    mount({
      isLoading: true,
      onStop: () => {
        interrupted += 1;
      },
    });

    act(() => byLabel('中断')!.click());

    expect(interrupted).toBe(1);
  });
});

describe('中断后取回排队文本', () => {
  it('取回的文本自动填进输入框', () => {
    mount({ restoredDraft: { text: '第二句', seq: 1 } });

    expect(textarea().value).toBe('第二句');
  });

  it('同一个 seq 重发不会盖掉用户已经改过的内容', () => {
    mount({ restoredDraft: { text: '原话', seq: 1 } });
    type('原话，但我改了一下');

    mount({ restoredDraft: { text: '原话', seq: 1 } });

    expect(textarea().value).toBe('原话，但我改了一下');
  });

  it('新的 seq 允许再次写入', () => {
    mount({ restoredDraft: { text: '第一次', seq: 1 } });
    mount({ restoredDraft: { text: '第二次', seq: 2 } });

    expect(textarea().value).toBe('第二次');
  });
});
