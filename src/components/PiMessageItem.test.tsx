// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PiMessage } from '../types/pi';
import { PiMessageItem } from './PiMessageItem';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLElement;

const render = (message: PiMessage) => {
  act(() => {
    root.render(<PiMessageItem message={message} />);
  });
};

const hasEnterAnimation = () => host.querySelector('.paper-in') !== null;

const message = (over: Partial<PiMessage> = {}): PiMessage => ({
  id: 'm1',
  role: 'assistant',
  content: '正文',
  timestamp: 1,
  status: 'done',
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
  // 图片查看器是传送门，挂在 body 上。先 unmount 再由这里兵底清，
  // 顺序反了的话 React 卸载时会报「node to be removed is not a child」。
  document.body.querySelectorAll('[role="dialog"]').forEach(node => node.remove());
});

describe('入场动画', () => {
  it('刚刚产生的消息才播动画', () => {
    render(message());

    expect(hasEnterAnimation()).toBe(true);
  });

  it('切换会话 / 重连恢复出来的历史不播动画', () => {
    // 从会话记录恢复的整段对话如果播动画，看起来就像对话被重新加载了一遍
    render(message({ fromHistory: true }));

    expect(hasEnterAnimation()).toBe(false);
  });

  it('用户消息同样遵循这条规则', () => {
    render(message({ role: 'user', fromHistory: true }));
    expect(hasEnterAnimation()).toBe(false);

    render(message({ role: 'user' }));
    expect(hasEnterAnimation()).toBe(true);
  });
});

describe('用户消息里的附件', () => {
  const user = (over: Partial<PiMessage> = {}) =>
    message({ role: 'user', content: '', ...over });

  it('图片直接渲染成图片，而不是文件名', () => {
    render(
      user({
        attachments: [
          { kind: 'image', name: '图片 1', dataUrl: 'data:image/png;base64,QUJD' },
        ],
      })
    );

    const img = host.querySelector('img');
    expect(img?.getAttribute('src')).toBe('data:image/png;base64,QUJD');
  });

  it('文件渲染成卡片，带文件名与路径提示', () => {
    render(
      user({
        attachments: [
          { kind: 'file', name: '报告.docx', path: '.pi-web-uploads/报告.docx' },
        ],
      })
    );

    const card = host.querySelector('button[title*=".pi-web-uploads/报告.docx"]');
    expect(card?.textContent).toContain('报告.docx');
    expect(host.querySelector('img')).toBeNull();
  });

  it('图片和文件同时存在时两者都渲染', () => {
    render(
      user({
        content: '一起看',
        attachments: [
          { kind: 'image', name: '图片 1', dataUrl: 'data:image/png;base64,QUJD' },
          { kind: 'file', name: 'a.txt', path: '.pi-web-uploads/a.txt' },
        ],
      })
    );

    expect(host.querySelector('img')).not.toBeNull();
    expect(host.textContent).toContain('a.txt');
    expect(host.textContent).toContain('一起看');
  });

  it('只有附件、没有正文时不渲染空气泡', () => {
    render(
      user({
        attachments: [{ kind: 'image', name: '图片 1', dataUrl: 'data:image/png;base64,QUJD' }],
      })
    );

    expect(host.textContent?.trim()).toBe('');
    expect(host.querySelector('img')).not.toBeNull();
  });
});

describe('点开附件', () => {
  const user = (over: Partial<PiMessage> = {}) =>
    message({ role: 'user', content: '', ...over });
  const image = { kind: 'image' as const, name: '截图', dataUrl: 'data:image/png;base64,QUJD' };
  const file = { kind: 'file' as const, name: '报告.docx', path: '.pi-web-uploads/报告.docx' };

  /** 查看器挂在 body 上（传送门），不在消息里 */
  const dialog = () => document.body.querySelector('[role="dialog"]');
  const openImage = () => {
    act(() => {
      (host.querySelector('button[aria-label="放大查看 截图"]') as HTMLButtonElement).click();
    });
  };

  it('点图片会放大查看', () => {
    render(user({ attachments: [image] }));
    expect(dialog()).toBeNull();

    openImage();

    expect(dialog()).not.toBeNull();
    expect(dialog()?.querySelector('img')?.getAttribute('src')).toBe(image.dataUrl);
  });

  it('查看器挂在 body 上，而不是消息里面', () => {
    // 就地渲染的话，新消息的 `.paper-in` 动画（fill-mode: both）会留着 transform，
    // 把 fixed 劫持成相对消息元素——遮罩盖不满、图片按原尺寸铺开
    render(user({ attachments: [image] }));

    openImage();

    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it('图片按视口大小约束，不按容器百分比', () => {
    render(user({ attachments: [image] }));
    openImage();

    const img = dialog()?.querySelector('img');
    expect(img?.className).toContain('max-h-[90vh]');
    expect(img?.className).toContain('max-w-[90vw]');
  });

  it('点图片外部关闭', () => {
    render(user({ attachments: [image] }));
    openImage();

    act(() => {
      (dialog() as HTMLElement).click();
    });

    expect(dialog()).toBeNull();
  });

  it('点图片本身也关闭', () => {
    render(user({ attachments: [image] }));
    openImage();

    act(() => {
      const img = dialog()?.querySelector('img');
      if (!img) throw new Error('没找到图片');
      img.click();
    });

    expect(dialog()).toBeNull();
  });

  it('按 Esc 关闭', () => {
    render(user({ attachments: [image] }));
    openImage();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(dialog()).toBeNull();
  });

  it('点文件卡片会把路径交给上层（系统默认程序打开）', () => {
    const onOpenFile = vi.fn();
    act(() => {
      root.render(<PiMessageItem message={user({ attachments: [file] })} onOpenFile={onOpenFile} />);
    });

    act(() => {
      (host.querySelector('button[title*="报告.docx"]') as HTMLButtonElement).click();
    });

    expect(onOpenFile).toHaveBeenCalledWith('.pi-web-uploads/报告.docx');
  });

  it('没有打开能力时文件卡片不可点', () => {
    render(user({ attachments: [file] }));

    const card = host.querySelector('button[title*="报告.docx"]') as HTMLButtonElement;
    expect(card.disabled).toBe(true);
  });
});
