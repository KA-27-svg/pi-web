import * as path from 'path';
import * as fs from 'fs/promises';

/** 一次最多返回多少条：超大目录（比如 node_modules）不该把界面拖死 */
export const MAX_DIR_ENTRIES = 500;

export interface DirEntry {
  name: string;
  /** 相对工作目录的路径，统一用正斜杠 */
  path: string;
  isDir: boolean;
  bytes?: number;
}

export interface DirListing {
  path: string;
  /** 上一级；已经是工作目录根时为 null（不允许继续往上翻） */
  parent: string | null;
  entries: DirEntry[];
}

/**
 * 把相对路径解析到工作目录之内。越界一律拒绝。
 *
 * 这是「浏览工作目录」功能的安全边界：请求来自浏览器，`../../..` 和绝对路径
 * 都必须被挡住，否则这里就成了一个任意目录列举接口。
 */
export function resolveWithin(root: string, relative: unknown): string {
  const base = path.resolve(root);
  const raw = typeof relative === 'string' ? relative : '';

  if (path.isAbsolute(raw)) throw new Error('只接受相对路径');

  const target = path.resolve(base, raw);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('路径超出工作目录');
  }
  return target;
}

/** 转成正斜杠的相对路径：前端显示与回传都用它 */
function toRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

export async function listDirectory(cwd: string, relative: unknown): Promise<DirListing> {
  const root = path.resolve(cwd);
  const dir = resolveWithin(root, relative);

  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('目录不存在或不是目录');

  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const entries: DirEntry[] = [];

  for (const dirent of dirents) {
    // 隐藏项不列：.git / .venv 之类只会把列表刷满，真要传可以走上传
    if (dirent.name.startsWith('.')) continue;

    const full = path.join(dir, dirent.name);
    // 符号链接的 isDirectory() 为 false，会按文件处理——不会顺着链接跳出工作目录
    const isDir = dirent.isDirectory();
    const bytes = isDir ? undefined : (await fs.stat(full).catch(() => null))?.size;

    entries.push({ name: dirent.name, path: toRelative(root, full), isDir, bytes });
  }

  entries.sort((a, b) =>
    a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh') : a.isDir ? -1 : 1
  );

  const current = toRelative(root, dir);
  return {
    path: current,
    parent: current === '' ? null : current.slice(0, Math.max(0, current.lastIndexOf('/'))),
    entries: entries.slice(0, MAX_DIR_ENTRIES),
  };
}
