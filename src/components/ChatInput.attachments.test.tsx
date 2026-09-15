// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AttachmentContent } from '../types/pi';
import { MAX_IMAGE_BYTES, type UploadedFile } from '../utils/attachments';
import { ChatInput } from './ChatInput';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => {};

let root: Root;
let host: HTMLElement;

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

const mount = (props: Partial<React.ComponentProps<typeof ChatInput>> = {}) => {
  act(() => {
    root.render(<ChatInput onSend={noop} onStop={noop} isLoading={false} {...props} />);
  });
};

const textarea = () => host.querySelector('textarea') as HTMLTextAreaElement;
const attachButton = () => host.querySelector('button[aria-label="添加附件"]') as HTMLButtonElement | null;
const sendButton = () => host.querySelector('button[aria-label="发送"]') as HTMLButtonElement | null;
const chipNames = () =>
  Array.from(host.querySelectorAll('span.truncate')).map(node => node.textContent);

const findByText = (text: string) =>
  Array.from(host.querySelectorAll('button')).find(button =>
    button.textContent?.includes(text)
  ) as HTMLButtonElement | undefined;

const click = async (element: HTMLElement | undefined) => {
  if (!element) throw new Error('元素不存在');
  await act(async () => {
    element.click();
  });
};

/** 走 React 受控组件的正常路径改值 */
const type = (value: string) => {
  const el = textarea();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  setter?.call(el, value);
  act(() => {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** jsdom 没有 DataTransfer/ClipboardData 构造器，手工挂上 files */
const fileEvent = (type: 'drop' | 'paste', files: File[]) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, type === 'drop' ? 'dataTransfer' : 'clipboardData', {
    value: { files },
  });
  return event;
};

const drop = async (files: File[]) => {
  await act(async () => {
    host.firstElementChild?.dispatchEvent(fileEvent('drop', files));
  });
};

const openMenu = async () => {
  await click(attachButton() ?? undefined);
};

// ── 测试数据 ──────────────────────────────────────────────

/** 文本文件：内容里没有 NUL，会被当成文本内联 */
const textFile = (name: string, content = 'export const a = 1;\n') =>
  new File([content], name, { type: 'text/plain' });

/** 二进制文件：开头有 NUL，只能走落盘通道 */
const binaryFile = (name: string) => new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00])], name);

const png = (name = 'shot.png') =>
  new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

const uploadOk = () =>
  vi.fn(
    async (file: File): Promise<UploadedFile> => ({
      path: `C:/work/.pi-web-uploads/${file.name}`,
      relativePath: `.pi-web-uploads/${file.name}`,
      name: file.name,
      bytes: file.size,
    })
  );

// ── 测试 ──────────────────────────────────────────────────

describe('附件入口', () => {
  it('没有任何选择通道时不显示附件按钮', () => {
    mount();
    expect(attachButton()).toBeNull();
  });

  it('点一下只是打开菜单，不直接做任何事', async () => {
    const onPickFile = vi.fn(async () => []);
    mount({ onPickFile });

    await openMenu();

    expect(findByText('从电脑选择')).toBeDefined();
    expect(onPickFile).not.toHaveBeenCalled();
  });

  it('两个通道都在时菜单里有两项', async () => {
    mount({ onPickFile: vi.fn(async () => []), onListDir: vi.fn(async () => ({ path: '', parent: null, entries: [] })) });

    await openMenu();

    expect(findByText('从电脑选择')).toBeDefined();
    expect(findByText('从项目里选择')).toBeDefined();
  });
});

describe('从电脑选择（不复制文件）', () => {
  const readText = vi.fn(
    async (): Promise<AttachmentContent> => ({
      kind: 'text',
      text: 'export const a = 1;\n',
      truncated: false,
      bytes: 21,
    })
  );

  it('选中的文件不会被复制到工作目录', async () => {
    const onUploadFile = uploadOk();
    const onPickFile = vi.fn(async () => ['C:/Users/me/Desktop/a.ts']);
    mount({ onPickFile, onUploadFile, onReadAttachment: readText });

    await openMenu();
    await click(findByText('从电脑选择'));

    // 这是这次改动的核心：一个字节都不落盘
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(onPickFile).toHaveBeenCalled();
    expect(chipNames()).toContain('a.ts');
    expect(host.textContent).toContain('已内联');
  });

  it('路径是绝对的，内容一起进 prompt', async () => {
    const onSend = vi.fn();
    mount({
      onPickFile: vi.fn(async () => ['C:/Users/me/Desktop/a.ts']),
      onReadAttachment: readText,
      onSend,
    });

    await openMenu();
    await click(findByText('从电脑选择'));
    type('看看');
    await click(sendButton() ?? undefined);

    expect(onSend.mock.calls[0][0].files).toEqual([
      {
        name: 'a.ts',
        path: 'C:/Users/me/Desktop/a.ts',
        content: 'export const a = 1;\n',
        truncated: false,
      },
    ]);
  });

  it('二进制文件只留路径，没有内容', async () => {
    const onSend = vi.fn();
    mount({
      onPickFile: vi.fn(async () => ['C:/Users/me/Desktop/报告.docx']),
      onReadAttachment: vi.fn(async () => ({ kind: 'binary', bytes: 12 }) as AttachmentContent),
      onSend,
    });

    await openMenu();
    await click(findByText('从电脑选择'));
    type('总结一下');
    await click(sendButton() ?? undefined);

    const file = onSend.mock.calls[0][0].files[0];
    expect(file.path).toBe('C:/Users/me/Desktop/报告.docx');
    expect(file.content).toBeUndefined();
    expect(host.textContent).not.toContain('已内联');
  });

  it('图片走原生附件通道，并显示缩略图', async () => {
    const onSend = vi.fn();
    mount({
      onPickFile: vi.fn(async () => ['C:/Users/me/Desktop/shot.png']),
      onReadAttachment: vi.fn(
        async () =>
          ({
            kind: 'image',
            data: 'iVBORw0KGgo=',
            mimeType: 'image/png',
            bytes: 8,
          }) as AttachmentContent
      ),
      onSend,
    });

    await openMenu();
    await click(findByText('从电脑选择'));

    expect(host.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);

    type('这是什么');
    await click(sendButton() ?? undefined);

    expect(onSend.mock.calls[0][0].images).toHaveLength(1);
    expect(onSend.mock.calls[0][0].files).toEqual([]);
  });

  it('用户取消（没有选中任何文件）不会留下附件', async () => {
    mount({ onPickFile: vi.fn(async () => []) });

    await openMenu();
    await click(findByText('从电脑选择'));

    expect(host.querySelectorAll('span.truncate')).toHaveLength(0);
    expect(sendButton()?.disabled).toBe(true);
  });

  it('选择框起不来时给出可读的失败提示', async () => {
    mount({
      onPickFile: vi.fn(async () => {
        throw new Error('系统文件选择框目前只在 Windows 上实现');
      }),
    });

    await openMenu();
    await click(findByText('从电脑选择'));

    expect(host.textContent).toContain('失败');
    expect(host.textContent).toContain('只在 Windows');
  });
});

describe('从项目里选择', () => {
  it('挑中的文件同样不落盘，直接用它的路径', async () => {
    const onUploadFile = uploadOk();
    const onSend = vi.fn();
    mount({
      onUploadFile,
      onSend,
      onListDir: vi.fn(async () => ({
        path: '',
        parent: null,
        entries: [{ name: 'a.ts', path: 'src/a.ts', isDir: false, bytes: 10 }],
      })),
      onReadAttachment: vi.fn(async () => ({ kind: 'binary', bytes: 10 }) as AttachmentContent),
    });

    await openMenu();
    await click(findByText('从项目里选择'));
    await act(async () => {});
    await click(findByText('a.ts'));

    expect(onUploadFile).not.toHaveBeenCalled();

    type('看下');
    await click(sendButton() ?? undefined);

    expect(onSend.mock.calls[0][0].files).toEqual([
      { name: 'a.ts', path: 'src/a.ts', content: undefined, truncated: undefined },
    ]);
  });
});

describe('拖拽与粘贴', () => {
  it('拖进来的文本文件直接在浏览器里读出来，不落盘', async () => {
    const onUploadFile = uploadOk();
    mount({ onUploadFile });

    await drop([textFile('notes.md', '# 标题\n')]);

    expect(onUploadFile).not.toHaveBeenCalled();
    expect(chipNames()).toContain('notes.md');
    expect(host.textContent).toContain('已内联');
  });

  it('拖进来的二进制文件才走落盘（那时拿不到路径）', async () => {
    const onUploadFile = uploadOk();
    mount({ onUploadFile });

    await drop([binaryFile('报告.docx')]);

    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(chipNames()).toContain('报告.docx');
  });

  it('拖进来的图片走原生通道，不落盘', async () => {
    const onUploadFile = uploadOk();
    mount({ onUploadFile });

    await drop([png()]);

    expect(onUploadFile).not.toHaveBeenCalled();
    expect(host.querySelector('img')).not.toBeNull();
  });

  it('粘贴截图不会把文件名当文本插进输入框', async () => {
    mount();
    await act(async () => {
      textarea().dispatchEvent(fileEvent('paste', [png('image.png')]));
    });

    expect(textarea().value).toBe('');
    expect(host.querySelector('img')).not.toBeNull();
  });

  it('超过上限的图片当场报错', async () => {
    mount();
    const huge = new File([new Uint8Array(MAX_IMAGE_BYTES + 10)], 'big.png', { type: 'image/png' });

    await drop([huge]);

    expect(host.textContent).toContain('失败');
  });
});

describe('移除与发送', () => {
  it('可以单独移除一个附件', async () => {
    mount({ onUploadFile: uploadOk() });
    await drop([binaryFile('a.docx')]);

    await click(host.querySelector('button[aria-label="移除 a.docx"]') as HTMLButtonElement);

    expect(chipNames()).toEqual([]);
  });

  it('只有附件、没有正文也能发出', async () => {
    const onSend = vi.fn();
    mount({ onUploadFile: uploadOk(), onSend });
    await drop([binaryFile('a.docx')]);

    await click(sendButton() ?? undefined);

    expect(onSend).toHaveBeenCalled();
    expect(onSend.mock.calls[0][0].text).toBe('');
    expect(chipNames()).toEqual([]);
  });

  it('什么都没写、也没有附件时发不出去', () => {
    mount({ onUploadFile: uploadOk() });
    expect(sendButton()?.disabled).toBe(true);
  });
});
