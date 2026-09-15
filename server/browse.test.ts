import { describe, expect, it } from 'vitest';
import { listDirectory, resolveWithin } from './browse';

describe('resolveWithin', () => {
  const root = resolveRoot();

  function resolveRoot() {
    // 单独抽出来，避免在断言里重复写
    return process.platform === 'win32' ? 'C:\\work\\proj' : '/work/proj';
  }

  it('空路径就是工作目录本身', () => {
    expect(resolveWithin(root, '')).toBe(root);
    expect(resolveWithin(root, undefined)).toBe(root);
  });

  it('相对路径拼在工作目录下', () => {
    expect(resolveWithin(root, 'src')).toBe(`${root}${sep()}src`);
    expect(resolveWithin(root, 'src/a.ts')).toBe(`${root}${sep()}src${sep()}a.ts`);
  });

  it('越界的 .. 被拒绝', () => {
    // 这条是安全边界：桥接只允许看工作目录里面
    expect(() => resolveWithin(root, '..')).toThrow(/超出工作目录/);
    expect(() => resolveWithin(root, '../other')).toThrow(/超出工作目录/);
    expect(() => resolveWithin(root, 'src/../../x')).toThrow(/超出工作目录/);
  });

  it('绝对路径被拒绝', () => {
    expect(() => resolveWithin(root, process.platform === 'win32' ? 'C:\\Windows' : '/etc')).toThrow(
      /相对路径/
    );
  });

  it('规范化之后仍在目录内的 .. 允许', () => {
    expect(resolveWithin(root, 'src/../lib')).toBe(`${root}${sep()}lib`);
  });

  function sep() {
    return process.platform === 'win32' ? '\\' : '/';
  }
});

describe('listDirectory', () => {
  it('列出条目：目录在前，隐藏项不列，带上大小', async () => {
    const cwd = await makeTree({
      'b.txt': 'hello',
      'a.txt': 'hi',
      '.env': 'secret',
      src: { 'index.ts': 'x' },
    });

    const listing = await listDirectory(cwd, '');

    expect(listing.entries.map(e => e.name)).toEqual(['src', 'a.txt', 'b.txt']);
    expect(listing.entries[0]).toMatchObject({ isDir: true, path: 'src' });
    expect(listing.entries[1]).toMatchObject({ isDir: false, path: 'a.txt', bytes: 2 });
    // 隐藏文件不出现在列表里，减少噪音
    expect(listing.entries.map(e => e.name)).not.toContain('.env');
  });

  it('可以进入子目录，并给出返回上一级的路径', async () => {
    const cwd = await makeTree({ src: { deep: { 'a.ts': 'x' } } });

    const inner = await listDirectory(cwd, 'src/deep');

    expect(inner.path).toBe('src/deep');
    expect(inner.parent).toBe('src');
    expect(inner.entries.map(e => e.name)).toEqual(['a.ts']);
  });

  it('工作目录根没有上一级（不允许往上翻）', async () => {
    const cwd = await makeTree({ 'a.txt': 'x' });

    const listing = await listDirectory(cwd, '');

    expect(listing.path).toBe('');
    expect(listing.parent).toBeNull();
  });

  it('上层目录同样能返回', async () => {
    const cwd = await makeTree({ src: { 'a.ts': 'x' } });

    expect((await listDirectory(cwd, 'src')).parent).toBe('');
  });

  it('路径逃逸被拒绝', async () => {
    const cwd = await makeTree({ 'a.txt': 'x' });

    await expect(listDirectory(cwd, '../..')).rejects.toThrow(/超出工作目录/);
  });

  it('不存在或不是目录时报错', async () => {
    const cwd = await makeTree({ 'a.txt': 'x' });

    await expect(listDirectory(cwd, 'nope')).rejects.toThrow(/目录不存在/);
    await expect(listDirectory(cwd, 'a.txt')).rejects.toThrow(/目录不存在/);
  });
});

// ── 测试辅助 ──────────────────────────────────────────────

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/** 用嵌套对象造一棵临时目录树 */
async function makeTree(tree: Record<string, unknown>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-browse-'));

  const walk = async (dir: string, node: Record<string, unknown>) => {
    for (const [name, value] of Object.entries(node)) {
      const full = path.join(dir, name);
      if (typeof value === 'string') {
        await fs.writeFile(full, value, 'utf-8');
      } else {
        await fs.mkdir(full, { recursive: true });
        await walk(full, value as Record<string, unknown>);
      }
    }
  };

  await walk(root, tree);
  return root;
}
