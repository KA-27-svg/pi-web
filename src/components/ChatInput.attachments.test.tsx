// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatInput } from './ChatInput';
import type { UploadedFile } from '../utils/attachments';

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
const attachButton = () => host.querySelector('button[aria-label="添加附件"]');
const sendButton = () => host.querySelector('button[aria-label="发送"]') as HTMLButtonElement | null;
const chipNames = () =>
  Array.from(host.querySelectorAll('span.truncate')).map(node => node.textContent);

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

const uploadOk = (name: string, relativePath?: string) =>
  vi.fn().mockResolvedValue({
    path: `C:/work/.pi-web-uploads/${name}`,
    relativePath: relativePath ?? `.pi-web-uploads/${name}`,
    name,
    bytes: 5,
  });

describe('附件入口', () => {
  it('没提供上传通道时不显示回形针', () => {
    mount();
    expect(attachButton()).toBeNull();
  });

  it('提供了上传通道就显示回形针', () => {
    mount({ onUploadFile: uploadOk('a.txt') });
    expect(attachButton()).not.toBeNull();
  });
});

describe('拖入文件', () => {
  it('上传成功后出现附件条，发送时把路径写进消息', async () => {
    const onUploadFile = uploadOk('报告.docx');
    const onSend = vi.fn();
    mount({ onUploadFile, onSend });

    await drop([new File(['x'], '报告.docx')]);

    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(chipNames()).toContain('报告.docx');

    type('总结一下');
    act(() => sendButton()?.click());

    expect(onSend).toHaveBeenCalledWith('[附件] .pi-web-uploads/报告.docx\n\n总结一下');
  });

  it('上传中显示占位，完成后换成落盘后的文件名', async () => {
    let release: (() => void) | undefined;
    const onUploadFile = vi.fn(
      () =>
        new Promise<UploadedFile>(resolve => {
          release = () =>
            resolve({
              path: 'C:/work/.pi-web-uploads/a-1.txt',
              relativePath: '.pi-web-uploads/a-1.txt',
              name: 'a-1.txt',
              bytes: 5,
            });
        })
    );
    mount({ onUploadFile });

    await act(async () => {
      host.firstElementChild?.dispatchEvent(fileEvent('drop', [new File(['x'], 'a.txt')]));
    });
    expect(chipNames()).toContain('a.txt');
    expect(host.querySelector('.animate-spin')).not.toBeNull();

    await act(async () => {
      release?.();
    });
    expect(chipNames()).toContain('a-1.txt');
  });

  it('上传失败时标记失败，且不能只靠附件发送', async () => {
    const onUploadFile = vi.fn().mockRejectedValue(new Error('文件太大'));
    mount({ onUploadFile });

    await drop([new File(['x'], 'big.bin')]);

    expect(host.textContent).toContain('失败');
    expect(sendButton()?.disabled).toBe(true);
  });

  it('多个文件逐个上传，顺序与拖入一致', async () => {
    // 名字从文件本身取，否则看不出 chip 对应的是哪个文件
    const onUploadFile = vi.fn(async (file: File): Promise<UploadedFile> => ({
      path: `C:/work/.pi-web-uploads/${file.name}`,
      relativePath: `.pi-web-uploads/${file.name}`,
      name: file.name,
      bytes: file.size,
    }));
    mount({ onUploadFile });

    await drop([new File(['1'], 'a.txt'), new File(['2'], 'b.txt')]);

    expect(onUploadFile.mock.calls.map(c => (c[0] as File).name)).toEqual(['a.txt', 'b.txt']);
    expect(chipNames()).toEqual(['a.txt', 'b.txt']);
  });
});

describe('粘贴与移除', () => {
  it('粘贴截图会走上传，而不是把文件名当文本插进输入框', async () => {
    const onUploadFile = uploadOk('image.png');
    mount({ onUploadFile });

    await act(async () => {
      textarea().dispatchEvent(fileEvent('paste', [new File(['x'], 'image.png')]));
    });

    expect(onUploadFile).toHaveBeenCalledTimes(1);
    expect(chipNames()).toContain('image.png');
    expect(textarea().value).toBe('');
  });

  it('点移除可以去掉附件', async () => {
    mount({ onUploadFile: uploadOk('a.txt') });
    await drop([new File(['x'], 'a.txt')]);

    act(() => {
      (host.querySelector('button[aria-label="移除 a.txt"]') as HTMLButtonElement).click();
    });

    expect(chipNames()).toEqual([]);
  });

  it('只有附件、没有正文也能发送', async () => {
    const onSend = vi.fn();
    mount({ onUploadFile: uploadOk('a.txt'), onSend });
    await drop([new File(['x'], 'a.txt')]);

    act(() => sendButton()?.click());

    expect(onSend).toHaveBeenCalledWith(
      '[附件] .pi-web-uploads/a.txt\n\n（请读取以上附件）'
    );
    expect(chipNames()).toEqual([]);
  });
});
