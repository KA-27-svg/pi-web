import { describe, expect, it, vi } from 'vitest';
import type { PiBridge } from './piBridge';
import { createAttachmentActions } from './piAttachmentActions';

function harness(requestResult: unknown = {}) {
  const calls: Array<{ type: string; payload: Record<string, any> }> = [];
  const request = vi.fn(async (type: string, payload: Record<string, any> = {}) => {
    calls.push({ type, payload });
    return requestResult;
  });

  const bridge = {
    setMessages: vi.fn(),
    setStatus: vi.fn(),
    handler: {} as never,
    request,
    sendCommand: vi.fn(),
    isOpen: () => true,
  } as unknown as PiBridge;

  return { actions: createAttachmentActions(bridge), calls };
}

describe('attachment 动作', () => {
  it('列目录：走 request，带 path', async () => {
    const { actions, calls } = harness({ path: 'src', parent: '', entries: [] });

    await actions.listDir('src');

    expect(calls).toEqual([{ type: 'list_dir', payload: { path: 'src' } }]);
  });

  it('读附件：带 path', async () => {
    const { actions, calls } = harness({ kind: 'binary', bytes: 1 });

    await actions.readAttachment('C:/a.pdf');

    expect(calls).toEqual([{ type: 'read_attachment', payload: { path: 'C:/a.pdf' } }]);
  });

  it('弹选择框：取回 paths；用户取消（没有 paths）时返回空数组', async () => {
    const ok = harness({ paths: ['C:/a.png'] });
    await expect(ok.actions.pickFile()).resolves.toEqual(['C:/a.png']);
    expect(ok.calls[0]).toEqual({ type: 'pick_file', payload: { imagesOnly: false } });

    const cancelled = harness({});
    await expect(cancelled.actions.pickFile(true)).resolves.toEqual([]);
    expect(cancelled.calls[0]).toEqual({ type: 'pick_file', payload: { imagesOnly: true } });
  });

  it('上传：把文件名和 base64 一起发出去', async () => {
    const { actions, calls } = harness({
      path: '/w/.pi-web-uploads/a.txt',
      relativePath: '.pi-web-uploads/a.txt',
      name: 'a.txt',
      bytes: 3,
    });

    const file = new File([new Uint8Array([1, 2, 3])], 'a.txt');
    const uploaded = await actions.uploadFile(file);

    expect(calls[0].type).toBe('upload_file');
    expect(calls[0].payload.name).toBe('a.txt');
    expect(calls[0].payload.data).toBe('AQID');
    expect(uploaded.relativePath).toBe('.pi-web-uploads/a.txt');
  });

  it('打开附件：resolve 掉结果，不把桥接回包漏给调用方', async () => {
    const { actions, calls } = harness({});

    await expect(actions.openAttachment('C:/a.pdf')).resolves.toBeUndefined();
    expect(calls).toEqual([{ type: 'open_attachment', payload: { path: 'C:/a.pdf' } }]);
  });
});
