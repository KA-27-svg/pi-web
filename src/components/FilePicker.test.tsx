// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DirListing } from '../types/pi';
import { FilePicker } from './FilePicker';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

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

const listing = (over: Partial<DirListing> = {}): DirListing => ({
  path: '',
  parent: null,
  entries: [],
  ...over,
});

/** 挂载并等待第一次列举完成 */
const mount = async (props: Partial<React.ComponentProps<typeof FilePicker>> = {}) => {
  const onList = props.onList ?? vi.fn(async () => listing());
  await act(async () => {
    root.render(<FilePicker onList={onList} onPick={noop} onClose={noop} {...props} />);
  });
  return onList;
};

const rowTexts = () => Array.from(host.querySelectorAll('button')).map(b => b.textContent?.trim());
const findByText = (text: string) =>
  Array.from(host.querySelectorAll('button')).find(b => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;
const click = async (element: HTMLElement | undefined) => {
  if (!element) throw new Error('元素不存在');
  await act(async () => {
    element.click();
  });
};

describe('FilePicker', () => {
  it('列出工作目录里的条目', async () => {
    await mount({
      onList: vi.fn(async () =>
        listing({
          entries: [
            { name: 'src', path: 'src', isDir: true },
            { name: 'readme.md', path: 'readme.md', isDir: false, bytes: 2048 },
          ],
        })
      ),
    });

    expect(rowTexts()).toContain('src');
    expect(host.textContent).toContain('readme.md');
    expect(host.textContent).toContain('2.0 KB');
  });

  it('根目录时「上一级」不可用', async () => {
    await mount({ onList: vi.fn(async () => listing({ parent: null })) });

    const up = host.querySelector('button[aria-label="上一级"]') as HTMLButtonElement;
    expect(up.disabled).toBe(true);
  });

  it('进入子目录会带着子路径重新列举', async () => {
    const onList = vi.fn(async (path: string) =>
      path === ''
        ? listing({ entries: [{ name: 'src', path: 'src', isDir: true }] })
        : listing({ path: 'src', parent: '', entries: [{ name: 'a.ts', path: 'src/a.ts', isDir: false, bytes: 10 }] })
    );
    await mount({ onList });

    await click(findByText('src'));

    expect(onList).toHaveBeenLastCalledWith('src');
    expect(host.textContent).toContain('a.ts');
  });

  it('点文件不会进目录，而是把条目交给调用方', async () => {
    const onPick = vi.fn();
    await mount({
      onPick,
      onList: vi.fn(async () =>
        listing({ entries: [{ name: 'a.ts', path: 'src/a.ts', isDir: false, bytes: 10 }] })
      ),
    });

    await click(findByText('a.ts'));

    expect(onPick).toHaveBeenCalledWith({ name: 'a.ts', path: 'src/a.ts', isDir: false, bytes: 10 });
  });

  it('子目录里可以返回上一级', async () => {
    const onList = vi.fn(async (path: string) =>
      path === 'src'
        ? listing({ path: 'src', parent: '', entries: [{ name: 'deep', path: 'src/deep', isDir: true }] })
        : listing({ path: '', parent: null, entries: [{ name: 'src', path: 'src', isDir: true }] })
    );
    await mount({ onList });
    await click(findByText('src'));
    expect(onList).toHaveBeenLastCalledWith('src');

    await click(host.querySelector('button[aria-label="上一级"]') as HTMLButtonElement);

    expect(onList).toHaveBeenLastCalledWith('');
  });

  it('列举失败时显示原因，而不是空白面板', async () => {
    await mount({
      onList: vi.fn(async () => {
        throw new Error('路径超出工作目录');
      }),
    });

    expect(host.textContent).toContain('路径超出工作目录');
  });

  it('空目录有明确说法', async () => {
    await mount({ onList: vi.fn(async () => listing()) });

    expect(host.textContent).toContain('没有可列出的文件');
  });

  it('Esc 关闭', async () => {
    const onClose = vi.fn();
    await mount({ onClose });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(onClose).toHaveBeenCalled();
  });
});
