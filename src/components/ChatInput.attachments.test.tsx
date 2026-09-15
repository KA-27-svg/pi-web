// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChatInput } from './ChatInput';
import { MAX_IMAGE_BYTES, type UploadedFile } from '../utils/attachments';

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

    expect(onSend).toHaveBeenCalledWith({
      text: '总结一下',
      images: [],
      files: [{ name: '报告.docx', relativePath: '.pi-web-uploads/报告.docx' }],
    });
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

    expect(onSend).toHaveBeenCalledWith({
      text: '',
      images: [],
      files: [{ name: 'a.txt', relativePath: '.pi-web-uploads/a.txt' }],
    });
    expect(chipNames()).toEqual([]);
  });
});

const png = (name = 'shot.png', bytes = [137, 80, 78, 71]) =>
  new File([new Uint8Array(bytes)], name, { type: 'image/png' });

describe('图片走原生附件', () => {
  it('图片不落盘，直接以 base64 进 draft.images', async () => {
    const onUploadFile = vi.fn();
    const onSend = vi.fn();
    mount({ onUploadFile, onSend });

    await drop([png()]);

    // 关键分歧点：图片不应该被写成文件、也不应该只传一个路径
    expect(onUploadFile).not.toHaveBeenCalled();

    type('这个报错怎么修');
    act(() => sendButton()?.click());

    const draft = onSend.mock.calls[0][0];
    expect(draft.text).toBe('这个报错怎么修');
    expect(draft.files).toEqual([]);
    expect(draft.images).toHaveLength(1);
    expect(draft.images[0].mimeType).toBe('image/png');
    expect(atob(draft.images[0].data)).toBe('\u0089PNG');
  });

  it('附件条里直接显示缩略图', async () => {
    mount({ onUploadFile: vi.fn() });

    await drop([png()]);

    const thumb = host.querySelector('img');
    expect(thumb?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  });

  it('超过 5 MB 的图片当场报错，而不是发出去等 provider 拒', async () => {
    mount({ onUploadFile: vi.fn() });

    await drop([png('big.png', new Array(MAX_IMAGE_BYTES + 10).fill(1))]);

    expect(host.textContent).toContain('失败');
    expect(sendButton()?.disabled).toBe(true);
  });

  it('图片和文件混发时分别进入两条通道', async () => {
    const onUploadFile = uploadOk('报告.docx');
    const onSend = vi.fn();
    mount({ onUploadFile, onSend });

    await drop([png(), new File(['x'], '报告.docx')]);
    type('一起看');
    act(() => sendButton()?.click());

    const draft = onSend.mock.calls[0][0];
    expect(draft.images).toHaveLength(1);
    expect(draft.files).toEqual([
      { name: '报告.docx', relativePath: '.pi-web-uploads/报告.docx' },
    ]);
  });
});

describe('从工作目录选文件', () => {
  const workspace = (path: string) =>
    vi.fn(async () => ({
      path,
      parent: null,
      entries: [{ name: 'a.ts', path: 'src/a.ts', isDir: false, bytes: 10 }],
    }));

  it('没提供列目录能力时不显示入口', () => {
    mount({ onUploadFile: uploadOk('x.txt') });

    expect(host.querySelector('button[aria-label="从工作目录选择"]')).toBeNull();
  });

  it('选中的文件不需要上传字节，直接用它的路径', async () => {
    const onUploadFile = vi.fn();
    const onSend = vi.fn();
    const onListDir = workspace('');
    mount({ onUploadFile, onListDir, onSend });

    act(() => {
      (host.querySelector('button[aria-label="从工作目录选择"]') as HTMLButtonElement).click();
    });
    // 等 FilePicker 的首次列举落地
    await act(async () => {});

    const row = Array.from(host.querySelectorAll('button')).find(b =>
      b.textContent?.includes('a.ts')
    );
    act(() => {
      row?.click();
    });

    // 关键：根本没走上传——文件已经在磁盘上了
    expect(onUploadFile).not.toHaveBeenCalled();
    expect(chipNames()).toContain('a.ts');

    type('看下这个');
    act(() => sendButton()?.click());

    expect(onSend.mock.calls[0][0].files).toEqual([
      { name: 'a.ts', relativePath: 'src/a.ts' },
    ]);
  });
});

describe('文本文件内联内容', () => {
  const readOk = vi.fn(async () => ({ text: 'export const a = 1;\n', truncated: false, bytes: 21 }));

  it('文字文件读回内容后，附件条标出「已内联」', async () => {
    mount({ onUploadFile: uploadOk('a.ts'), onReadAttachment: readOk });

    await drop([new File(['x'], 'a.ts')]);
    await act(async () => {});

    expect(readOk).toHaveBeenCalledWith('.pi-web-uploads/a.ts');
    expect(host.textContent).toContain('已内联');
  });

  it('发送时内容跟着一起走，模型不用再自己去读', async () => {
    const onSend = vi.fn();
    mount({ onUploadFile: uploadOk('a.ts'), onReadAttachment: readOk, onSend });

    await drop([new File(['x'], 'a.ts')]);
    await act(async () => {});
    type('看看');
    act(() => sendButton()?.click());

    expect(onSend.mock.calls[0][0].files).toEqual([
      {
        name: 'a.ts',
        relativePath: '.pi-web-uploads/a.ts',
        content: 'export const a = 1;\n',
        truncated: false,
      },
    ]);
  });

  it('二进制文件不带内容，只留路径', async () => {
    const onSend = vi.fn();
    const readBinary = vi.fn(async () => ({ binary: true }));
    mount({ onUploadFile: uploadOk('a.docx'), onReadAttachment: readBinary, onSend });

    await drop([new File(['x'], 'a.docx')]);
    await act(async () => {});
    type('看看');
    act(() => sendButton()?.click());

    expect(host.textContent).not.toContain('已内联');
    expect(onSend.mock.calls[0][0].files[0].content).toBeUndefined();
  });

  it('读取失败不影响附件本身', async () => {
    const onSend = vi.fn();
    const readFails = vi.fn(async () => {
      throw new Error('读不到');
    });
    mount({ onUploadFile: uploadOk('a.ts'), onReadAttachment: readFails, onSend });

    await drop([new File(['x'], 'a.ts')]);
    await act(async () => {});

    // 读失败不该把附件也弄丢
    expect(chipNames()).toContain('a.ts');

    type('看看');
    act(() => sendButton()?.click());

    expect(onSend.mock.calls[0][0].files[0].relativePath).toBe('.pi-web-uploads/a.ts');
    expect(onSend.mock.calls[0][0].files[0].content).toBeUndefined();
  });
});
