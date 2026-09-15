// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_IMAGE_BYTES, prepareImageAttachment } from './attachments';

/**
 * canvas 与 createImageBitmap 在 jsdom 里都不存在，这里用最小替身把
 * 「解码 → 缩放 → 导出 JPEG」这条链路走通，重点验证**传进去的目标尺寸对不对**。
 */
const drawn: { width: number; height: number }[] = [];
const filled: string[] = [];

let originalCreateImageBitmap: unknown;

beforeEach(() => {
  drawn.length = 0;
  filled.length = 0;

  originalCreateImageBitmap = (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
    async () => ({ width: 4000, height: 3000, close: vi.fn() })
  );

  HTMLCanvasElement.prototype.getContext = function () {
    return {
      fillStyle: '',
      fillRect: () => filled.push('fill'),
      drawImage: (_source: unknown, _x: number, _y: number, width: number, height: number) => {
        drawn.push({ width, height });
      },
    };
  } as unknown as HTMLCanvasElement['getContext'];

  HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) {
    callback(new Blob([new Uint8Array([9, 9, 9])], { type: 'image/jpeg' }));
  } as unknown as HTMLCanvasElement['toBlob'];
});

afterEach(() => {
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = originalCreateImageBitmap;
});

describe('图片自动缩放', () => {
  it('4000×3000 的图会被缩到 2000×1500 并转成 JPEG', async () => {
    // 按 Anthropic 的公式，4000×3000 约 16000 tokens；缩到 2000×1500 只剩四分之一
    const file = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' });

    const prepared = await prepareImageAttachment(file);

    expect(drawn).toEqual([{ width: 2000, height: 1500 }]);
    expect(prepared.mimeType).toBe('image/jpeg');
    expect(prepared.dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  });

  it('缩小前先铺白底，避免透明区在 JPEG 里变黑', async () => {
    await prepareImageAttachment(new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' }));

    expect(filled).toContain('fill');
  });

  it('体积超限但尺寸合规时也会重编码（尺寸不变）', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => ({ width: 1200, height: 800, close: vi.fn() })
    );
    const big = new File([new Uint8Array([1])], 'big.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: MAX_IMAGE_BYTES + 1 });

    const prepared = await prepareImageAttachment(big);

    expect(drawn).toEqual([{ width: 1200, height: 800 }]);
    expect(prepared.mimeType).toBe('image/jpeg');
  });

  it('尺寸和体积都合规时原样发送，不掉画质也不丢动画', async () => {
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(
      async () => ({ width: 800, height: 600, close: vi.fn() })
    );
    const file = new File([new Uint8Array([1, 2, 3])], 'small.png', { type: 'image/png' });

    const prepared = await prepareImageAttachment(file);

    expect(drawn).toEqual([]);
    expect(prepared.mimeType).toBe('image/png');
  });

  it('解码出来的图不再需要时会被释放', async () => {
    const close = vi.fn();
    (globalThis as { createImageBitmap?: unknown }).createImageBitmap = vi.fn(async () => ({
      width: 5000,
      height: 5000,
      close,
    }));

    await prepareImageAttachment(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));

    expect(close).toHaveBeenCalled();
  });

  it('解码成功后仍产出的超大文件会被拦下', async () => {
    HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) {
      const blob = new Blob([new Uint8Array([1])], { type: 'image/jpeg' });
      Object.defineProperty(blob, 'size', { value: MAX_IMAGE_BYTES + 1 });
      callback(blob);
    } as unknown as HTMLCanvasElement['toBlob'];

    await expect(
      prepareImageAttachment(new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }))
    ).rejects.toThrow(/压缩/);
  });
});
