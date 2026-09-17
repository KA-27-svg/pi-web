// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CwdDialog } from './CwdDialog';

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

const render = (cwd = 'C:\\work', onChangeCwd = vi.fn(), onClose = vi.fn()) => {
  act(() => {
    root.render(<CwdDialog cwd={cwd} onClose={onClose} onChangeCwd={onChangeCwd} />);
  });
  return { onChangeCwd, onClose };
};

// 弹窗走传送门挂到 body 上
const input = () => document.body.querySelector('input') as HTMLInputElement;
const submit = () => document.body.querySelector('button[type="submit"]');
const switchButton = () =>
  [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === '切换');

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const click = (el: Element | null | undefined) =>
  act(() => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

describe('CwdDialog', () => {
  it('默认填着当前目录', () => {
    render('C:\\work');

    expect(input().value).toBe('C:\\work');
  });

  it('改成别的目录后点切换，会通知上层并关掉', () => {
    const { onChangeCwd, onClose } = render('C:\\work');

    setValue(input(), 'C:\\other');
    click(switchButton());

    expect(onChangeCwd).toHaveBeenCalledWith('C:\\other');
    expect(onClose).toHaveBeenCalled();
  });

  it('回车就等于点切换', () => {
    const { onChangeCwd } = render('C:\\work');

    setValue(input(), 'D:\\proj');
    act(() => {
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onChangeCwd).toHaveBeenCalledWith('D:\\proj');
  });

  it('没改或只改了空白时，切换是禁用的', () => {
    render('C:\\work');

    expect((switchButton() as HTMLButtonElement).disabled).toBe(true);

    setValue(input(), '   ');
    expect((switchButton() as HTMLButtonElement).disabled).toBe(true);

    setValue(input(), 'C:\\work');
    expect((switchButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('说清切换会发生什么：pi 会重启', () => {
    render();

    expect(document.body.textContent).toContain('重启');
  });

  it('说明这个控件是不是一个表单，避免回车触发页面级提交', () => {
    // 这里没有 <form>，回车是靠 onKeyDown 接的；有 form 的话要改成 submit 按钮
    render();

    expect(submit()).toBeNull();
  });
});
