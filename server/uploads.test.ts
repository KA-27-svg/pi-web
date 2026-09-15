import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_UPLOAD_BYTES,
  UPLOAD_DIR,
  decodeBase64,
  resolveUploadTarget,
  safeFileName,
  saveUpload,
  uniqueFileName,
} from './uploads';

describe('safeFileName', () => {
  it('只取文件名，丢掉路径部分', () => {
    expect(safeFileName('C:\\Users\\me\\报告.docx')).toBe('报告.docx');
    expect(safeFileName('/tmp/a/b/c.txt')).toBe('c.txt');
  });

  it('把 .. 和隐藏文件的前导点去掉，堵住路径穿越', () => {
    expect(safeFileName('..')).toBe('file');
    expect(safeFileName('../..')).toBe('file');
    expect(safeFileName('...hidden.txt')).toBe('hidden.txt');
  });

  it('替换 Windows 非法字符与控制字符', () => {
    expect(safeFileName('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt');
    expect(safeFileName('a\u0000b\u001fc.txt')).toBe('abc.txt');
  });

  it('去掉首尾空白，并限制长度', () => {
    expect(safeFileName('  spaced.txt  ')).toBe('spaced.txt');
    const long = `${'x'.repeat(500)}.txt`;
    expect(safeFileName(long).length).toBeLessThanOrEqual(120);
  });

  it('净化后什么都不剩时给一个兜底名', () => {
    expect(safeFileName('')).toBe('file');
    expect(safeFileName('   ')).toBe('file');
    expect(safeFileName(undefined)).toBe('file');
    expect(safeFileName(123)).toBe('file');
  });

  it('保留中文与常见符号，不要过度净化', () => {
    expect(safeFileName('2026 年度-报告 (最终版).xlsx')).toBe('2026 年度-报告 (最终版).xlsx');
  });
});

describe('uniqueFileName', () => {
  it('不冲突就原样返回', () => {
    expect(uniqueFileName('a.txt', ['b.txt'])).toBe('a.txt');
  });

  it('冲突时在扩展名前追加序号', () => {
    expect(uniqueFileName('a.txt', ['a.txt'])).toBe('a-1.txt');
    expect(uniqueFileName('a.txt', ['a.txt', 'a-1.txt'])).toBe('a-2.txt');
  });

  it('没有扩展名也能加序号', () => {
    expect(uniqueFileName('LICENSE', ['LICENSE'])).toBe('LICENSE-1');
  });
});

describe('resolveUploadTarget', () => {
  it('落在工作目录下的上传目录里', () => {
    const cwd = path.resolve('C:/work/proj');
    const target = resolveUploadTarget(cwd, 'a.txt');

    expect(target).toBe(path.join(cwd, UPLOAD_DIR, 'a.txt'));
  });

  it('穿越用的名字在净化阶段就被处理，最终仍落在上传目录内', () => {
    const cwd = path.resolve('C:/work/proj');
    const target = resolveUploadTarget(cwd, '../../evil.txt');

    expect(target.startsWith(path.join(cwd, UPLOAD_DIR) + path.sep)).toBe(true);
  });
});

describe('decodeBase64', () => {
  const bytes = (n: number) => Buffer.alloc(n, 1).toString('base64');

  it('解出原始字节', () => {
    expect(decodeBase64(Buffer.from('你好').toString('base64')).toString('utf-8')).toBe('你好');
  });

  it('容忍带 data URL 前缀的内容', () => {
    const raw = Buffer.from('abc').toString('base64');
    expect(decodeBase64(`data:application/octet-stream;base64,${raw}`).toString()).toBe('abc');
  });

  it('超过上限直接拒绝，不先分配内存', () => {
    expect(() => decodeBase64(bytes(MAX_UPLOAD_BYTES + 10))).toThrow(/太大|上限/);
  });

  it('非字符串或空内容拒绝', () => {
    expect(() => decodeBase64(undefined)).toThrow();
    expect(() => decodeBase64(123)).toThrow();
    expect(() => decodeBase64('')).toThrow();
  });
});

describe('saveUpload', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-upload-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('写出文件并回报路径与大小', async () => {
    const result = await saveUpload(cwd, '报告.docx', Buffer.from('hello').toString('base64'));

    expect(result.name).toBe('报告.docx');
    expect(result.bytes).toBe(5);
    expect(result.path).toBe(path.join(cwd, UPLOAD_DIR, '报告.docx'));
    expect(result.relativePath).toBe(`${UPLOAD_DIR}/报告.docx`);
    await expect(fs.readFile(result.path, 'utf-8')).resolves.toBe('hello');
  });

  it('上传目录里自带 .gitignore，避免污染项目 git status', async () => {
    await saveUpload(cwd, 'a.txt', Buffer.from('x').toString('base64'));

    await expect(fs.readFile(path.join(cwd, UPLOAD_DIR, '.gitignore'), 'utf-8')).resolves.toBe(
      '*\n'
    );
  });

  it('同名文件不会被覆盖，而是加序号', async () => {
    await saveUpload(cwd, 'a.txt', Buffer.from('first').toString('base64'));
    const second = await saveUpload(cwd, 'a.txt', Buffer.from('second').toString('base64'));

    expect(second.name).toBe('a-1.txt');
    await expect(
      fs.readFile(path.join(cwd, UPLOAD_DIR, 'a.txt'), 'utf-8')
    ).resolves.toBe('first');
    await expect(fs.readFile(second.path, 'utf-8')).resolves.toBe('second');
  });

  it('工作目录不存在时报错，而不是悄悄写到别处', async () => {
    await expect(
      saveUpload(path.join(cwd, 'not-here'), 'a.txt', Buffer.from('x').toString('base64'))
    ).rejects.toThrow(/工作目录/);
  });

  it('超大文件被拒绝，且不留下半个文件', async () => {
    const huge = Buffer.alloc(MAX_UPLOAD_BYTES + 10, 1).toString('base64');

    await expect(saveUpload(cwd, 'big.bin', huge)).rejects.toThrow(/太大|上限/);

    const entries = await fs.readdir(path.join(cwd, UPLOAD_DIR)).catch(() => []);
    expect(entries).not.toContain('big.bin');
  });
});
