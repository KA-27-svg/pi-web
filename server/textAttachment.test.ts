import { describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { MAX_INLINE_BYTES, looksBinary, readTextAttachment } from './textAttachment';

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

describe('readTextAttachment', () => {
  const write = async (name: string, content: string | Buffer) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-inline-'));
    await fs.writeFile(path.join(cwd, name), content);
    return cwd;
  };

  it('读出文本内容与大小', async () => {
    const cwd = await write('a.ts', 'export const a = 1;\n');

    const result = await readTextAttachment(cwd, 'a.ts');

    expect(result).toEqual({ text: 'export const a = 1;\n', truncated: false, bytes: 20 });
  });

  it('已知的二进制扩展名直接跳过，不浪费一次读', async () => {
    const cwd = await write('a.docx', Buffer.from('PK\u0003\u0004'));

    expect(await readTextAttachment(cwd, 'a.docx')).toBeNull();
  });

  it('没有扩展名时靠内容嗅探', async () => {
    const binary = await write('blob', Buffer.from([0x01, 0x00, 0x02]));
    const text = await write('LICENSE', 'MIT License\n');

    expect(await readTextAttachment(binary, 'blob')).toBeNull();
    expect((await readTextAttachment(text, 'LICENSE'))?.text).toBe('MIT License\n');
  });

  it('超过内联上限时截断并标记，文件本身不动', async () => {
    const big = 'x'.repeat(MAX_INLINE_BYTES + 500);
    const cwd = await write('big.log', big);

    const result = await readTextAttachment(cwd, 'big.log');

    expect(result?.truncated).toBe(true);
    expect(result?.text.length).toBe(MAX_INLINE_BYTES);
    expect(result?.bytes).toBe(big.length);
  });

  it('路径逃逸与不存在的文件都被拒绝', async () => {
    const cwd = await write('a.ts', 'x');

    await expect(readTextAttachment(cwd, '../secret.txt')).rejects.toThrow(/超出工作目录/);
    await expect(readTextAttachment(cwd, 'nope.ts')).rejects.toThrow(/文件不存在/);
  });

  it('目录不算文件', async () => {
    const cwd = await write('a.ts', 'x');
    await fs.mkdir(path.join(cwd, 'src'));

    await expect(readTextAttachment(cwd, 'src')).rejects.toThrow(/文件不存在/);
  });
});
