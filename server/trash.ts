import * as path from 'path';
import * as fs from 'fs/promises';
import { readSessionSummary, sessionsRoot } from './sessions.js';

/** 回收箱保留期：到期直接真删 */
export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * 回收箱放在会话目录的兄弟位置，而不是它内部：
 * 放进 sessions/ 里的话 pi 自己的会话列表也会扫到，就变成「网页删了、终端里还在」。
 */
export function trashRoot(): string {
  return (
    process.env.PI_TRASH_ROOT ||
    path.join(path.dirname(sessionsRoot()), 'sessions-trash')
  );
}

export interface TrashedSession {
  /** 回收箱里的路径 */
  path: string;
  id: string;
  name?: string;
  preview: string;
  cwd?: string;
  deletedAt: number;
  expiresAt: number;
}

/** 只接受位于给定根目录下、且后缀合法的路径，避免路径穿越 */
function resolveUnder(root: string, target: string, extension: string): string {
  const base = path.resolve(root) + path.sep;
  const resolved = path.resolve(target);
  if (!resolved.startsWith(base) || !resolved.endsWith(extension)) {
    throw new Error('invalid path');
  }
  return resolved;
}

const exists = (target: string) =>
  fs.stat(target).then(() => true, () => false);

/**
 * 把路径解析成「箱内路径」。两种入参都接受：
 *  - 箱内路径：回收箱视图点「恢复」时给的就是它；
 *  - 原位置路径：刚删除时的「撤销」只握有原位置，而此时还没来得及拉回收箱列表。
 * 因为目录结构是镜像的（sessions/<rel> ↔ sessions-trash/<rel>），两种能互相推导。
 * 两个根目录都不匹配的路径仍然会被拒绝。
 */
function resolveTrashEntry(candidate: string): string {
  try {
    return resolveUnder(trashRoot(), candidate, '.jsonl');
  } catch {
    const original = resolveUnder(sessionsRoot(), candidate, '.jsonl');
    return path.join(trashRoot(), path.relative(sessionsRoot(), original));
  }
}

/** 删掉空掉的目录，一路向上直到回收箱根目录为止 */
async function pruneEmptyDirs(dir: string): Promise<void> {
  const stop = path.resolve(trashRoot());
  let current = path.resolve(dir);

  while (current !== stop && current.startsWith(stop + path.sep)) {
    try {
      if ((await fs.readdir(current)).length > 0) return;
      await fs.rmdir(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/**
 * 把会话移入回收箱。目录结构原样镜像，
 * 所以「恢复」不需要额外记录原始路径——结构本身就是记录。
 */
export async function trashSession(sessionPath: string): Promise<void> {
  const root = sessionsRoot();
  const source = resolveUnder(root, sessionPath, '.jsonl');
  const target = path.join(trashRoot(), path.relative(root, source));

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);

  // 用 mtime 记录删除时间：保留期直接靠它判断，不需要额外的元数据文件。
  // 代价是恢复后会话会以「刚刚活动」排在列表前面，可以接受。
  const now = new Date();
  await fs.utimes(target, now, now);
}

export async function listTrash(): Promise<TrashedSession[]> {
  const root = trashRoot();
  let dirs: string[];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    dirs = entries.filter(e => e.isDirectory()).map(e => path.join(root, e.name));
  } catch {
    return [];
  }

  const found: TrashedSession[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const full = path.join(dir, name);
      try {
        const stat = await fs.stat(full);
        const summary = await readSessionSummary(full, stat.mtimeMs);
        found.push({
          path: full,
          id: summary.id,
          name: summary.name,
          preview: summary.preview,
          cwd: summary.cwd,
          deletedAt: stat.mtimeMs,
          expiresAt: stat.mtimeMs + TRASH_RETENTION_MS,
        });
      } catch {
        // 跳过损坏或不可读的条目
      }
    }
  }

  return found.sort((a, b) => b.deletedAt - a.deletedAt);
}

export async function restoreSession(sessionPath: string): Promise<void> {
  const source = resolveTrashEntry(sessionPath);
  const target = path.join(sessionsRoot(), path.relative(trashRoot(), source));

  if (await exists(target)) {
    throw new Error('原位置已存在同名会话，无法恢复');
  }

  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.rename(source, target);
  await pruneEmptyDirs(path.dirname(source));
}

/** 彻底删除一条 */
export async function purgeSession(sessionPath: string): Promise<void> {
  const target = resolveTrashEntry(sessionPath);
  await fs.unlink(target);
  await pruneEmptyDirs(path.dirname(target));
}

/** 清空回收箱 */
export async function emptyTrash(): Promise<number> {
  const items = await listTrash();
  let removed = 0;
  for (const item of items) {
    try {
      await fs.unlink(item.path);
      removed += 1;
    } catch {
      // 已经被删掉就算了
    }
  }
  await pruneEmptyDirs(trashRoot());
  return removed;
}

/**
 * 清掉超过保留期的条目。桥接不是常驻守护进程，所以不做后台定时器：
 * 启动时扫一次、每次打开回收箱时再扫一次就够了。
 */
export async function sweepTrash(now = Date.now()): Promise<number> {
  const items = await listTrash();
  let removed = 0;

  for (const item of items) {
    if (now - item.deletedAt <= TRASH_RETENTION_MS) continue;
    try {
      await fs.unlink(item.path);
      removed += 1;
    } catch {
      // 忽略
    }
  }

  if (removed > 0) await pruneEmptyDirs(trashRoot());
  return removed;
}
