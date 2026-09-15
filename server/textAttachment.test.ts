import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_IMAGE_READ_BYTES,
  MAX_INLINE_BYTES,
  looksBinary,
  readAttachment,
  resolveAttachment,
} from './textAttachment';

describe('looksBinary', () => {
  it('前若干字节里有 NUL 就当作二进制', () => {
    expect(looksBinary(Buffer.from([0x50, 0x00, 0x4e, 0x47]))).toBe(true);
  });

  it('普通文本不算二进制', () => {
    expect(looksBinary(Buffer.from('export const a = 1\n', 'utf-8'))).toBe(false);
    expect(looksBinary(Buffer.from('中文也没问题\n', 'utf-8'))).toBe(false);
  });

  it('只看开头一段，文件尾部的 NUL 不影响判断', () => {
    const buffer = Buffer.concat([Buffer.from('x'.repeat(9000)), Buffer.from([0])]);
    expect(looksBinary(buffer)).toBe(false);
  });

  it('空内容算文本', () => {
    expect(looksBinary(Buffer.alloc(0))).toBe(false);
  });
});

describe('resolveAttachment', () => {
  const cwd = path.resolve('C:/work/proj');
  const never = () => false;

  it('工作目录内的相对路径照常放行', () => {
    expect(resolveAttachment(cwd, 'src/a.ts', never)).toBe(path.join(cwd, 'src', 'a.ts'));
  });

  it('越界的相对路径仍然被拒', () => {
    expect(() => resolveAttachment(cwd, '../secret', never)).toThrow(/超出工作目录/);
  });

  it('绝对路径只有「用户刚亲手选过」才放行', () => {
    // 否则这个接口就是任意文件读取
    const outside = path.resolve('C:/Users/me/Desktop/a.png');

    expect(() => resolveAttachment(cwd, outside, never)).toThrow(/文件选择框/);
    expect(resolveAttachment(cwd, outside, p => p === outside)).toBe(outside);
  });
});

describe('readAttachment', () => {
  const write = async (name: string, content: string | Buffer) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-attach-'));
    const target = path.join(dir, name);
    await fs.writeFile(target, content);
    return target;
  };

  it('文本文件返回内容与大小', async () => {
    const target = await write('a.ts', 'export const a = 1;\n');

    expect(await readAttachment(target)).toEqual({
      kind: 'text',
      text: 'export const a = 1;\n',
      truncated: false,
      bytes: 20,
    });
  });

  it('没有扩展名时靠内容嗅探', async () => {
    const binary = await write('blob', Buffer.from([0x01, 0x00, 0x02]));
    const text = await write('LICENSE', 'MIT License\n');

    expect(await readAttachment(binary)).toEqual({ kind: 'binary', bytes: 3 });
    expect((await readAttachment(text)) as { text: string }).toMatchObject({ kind: 'text' });
  });

  it('图片返回 base64 与 MIME，交给前端走原生附件通道', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const target = await write('a.png', png);

    const result = await readAttachment(target);

    expect(result).toEqual({
      kind: 'image',
      data: png.toString('base64'),
      mimeType: 'image/png',
      bytes: png.length,
    });
  });

  it('已知的二进制扩展名不内联，只报大小', async () => {
    const target = await write('a.docx', Buffer.from('PK\u0003\u0004binary'));

    expect(await readAttachment(target)).toEqual({ kind: 'binary', bytes: 10 });
  });

  it('超过内联上限的文本会截断并标记', async () => {
    const big = 'x'.repeat(MAX_INLINE_BYTES + 500);
    const target = await write('big.log', big);

    const result = await readAttachment(target);

    expect(result).toMatchObject({ kind: 'text', truncated: true, bytes: big.length });
    expect((result as { text: string }).text.length).toBe(MAX_INLINE_BYTES);
  });

  it('超大图片直接拒绝，不把内存撑爆', async () => {
    const huge = Buffer.alloc(MAX_IMAGE_READ_BYTES + 10, 1);
    const target = await write('big.png', huge);

    await expect(readAttachment(target)).rejects.toThrow(/压缩/);
  });

  it('不存在或是目录都算「文件不存在」', async () => {
    const target = await write('a.ts', 'x');
    const dir = path.dirname(target);

    await expect(readAttachment(path.join(dir, 'nope.ts'))).rejects.toThrow(/文件不存在/);
    await expect(readAttachment(dir)).rejects.toThrow(/文件不存在/);
  });
});
