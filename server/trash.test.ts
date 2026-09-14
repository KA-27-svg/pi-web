import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  TRASH_RETENTION_MS,
  emptyTrash,
  listTrash,
  purgeSession,
  restoreSession,
  sweepTrash,
  trashRoot,
  trashSession,
} from './trash';
import { listSessions } from './sessions';

let tempHome: string;
let sessionsDir: string;
let trashDir: string;
let projectDir: string;
let sessionFile: string;

const header = () => JSON.stringify({ type: 'session', id: 'sess-1', cwd: 'C:\\demo' });
const userMessage = (text: string) =>
  JSON.stringify({ type: 'message', id: 'e1', parentId: null, message: { role: 'user', content: text } });

const writeSession = async (full: string, text = '问题') => {
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, [header(), userMessage(text)].join('\n'), 'utf-8');
  return full;
};

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-trash-'));
  sessionsDir = path.join(tempHome, 'sessions');
  trashDir = path.join(tempHome, 'sessions-trash');
  process.env.PI_SESSIONS_ROOT = sessionsDir;
  process.env.PI_TRASH_ROOT = trashDir;

  projectDir = path.join(sessionsDir, 'proj-abc');
  sessionFile = path.join(projectDir, '2026-01-01T00-00-00-000Z_aaa.jsonl');
});

afterEach(async () => {
  delete process.env.PI_SESSIONS_ROOT;
  delete process.env.PI_TRASH_ROOT;
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe('回收箱位置', () => {
  it('是会话目录的兄弟目录，不是它的子目录', () => {
    // 放进 sessions/ 里的话 pi 自己的会话列表也会扫到。
    // 注意不能只比字符串前缀：sessions-trash 恰好以 sessions 开头，
    // 判断子目录必须带上路径分隔符。
    expect(trashRoot()).toBe(trashDir);
    expect(trashRoot().startsWith(sessionsDir + path.sep)).toBe(false);
  });

  it('移入回收箱后不再出现在会话列表里', async () => {
    await writeSession(sessionFile);
    expect((await listSessions()).sessions).toHaveLength(1);

    await trashSession(sessionFile);

    expect((await listSessions()).sessions).toEqual([]);
    expect(await listTrash()).toHaveLength(1);
  });
});

describe('移入回收箱', () => {
  it('镜像原目录结构，原位置不再有文件', async () => {
    await writeSession(sessionFile, '待删除');

    await trashSession(sessionFile);

    await expect(fs.stat(sessionFile)).rejects.toThrow();
    const [item] = await listTrash();
    expect(item.path).toBe(path.join(trashDir, 'proj-abc', path.basename(sessionFile)));
    expect(item.preview).toBe('待删除');
    expect(item.cwd).toBe('C:\\demo');
  });

  it('把删除时间写进 mtime，并据此算出到期时间', async () => {
    await writeSession(sessionFile);
    const before = Date.now();

    await trashSession(sessionFile);

    const [item] = await listTrash();
    expect(item.deletedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(item.expiresAt - item.deletedAt).toBe(TRASH_RETENTION_MS);
  });

  it('按删除时间倒序排列', async () => {
    const first = await writeSession(path.join(projectDir, 'first.jsonl'), '先删的');
    const second = await writeSession(path.join(projectDir, 'second.jsonl'), '后删的');

    await trashSession(first);
    const later = new Date(Date.now() + 60_000);
    await trashSession(second);
    // 手动把第二条的删除时间推到更晚，避免两次调用的毫秒差不可靠
    const items = await listTrash();
    const target = items.find(i => i.path.includes('second.jsonl'))!;
    await fs.utimes(target.path, later, later);

    expect((await listTrash()).map(i => i.preview)).toEqual(['后删的', '先删的']);
  });
});

describe('恢复', () => {
  it('放回原项目目录，并清掉回收箱里的空目录', async () => {
    await writeSession(sessionFile, '待恢复');
    await trashSession(sessionFile);
    const [item] = await listTrash();

    await restoreSession(item.path);

    expect(await fs.readFile(sessionFile, 'utf-8')).toContain('待恢复');
    expect(await listTrash()).toEqual([]);
    await expect(fs.stat(path.join(trashDir, 'proj-abc'))).rejects.toThrow();
  });

  it('原位置已存在同名文件时拒绝恢复，不动回收箱里的那份', async () => {
    await writeSession(sessionFile, '回收箱里的');
    await trashSession(sessionFile);
    const [item] = await listTrash();

    await writeSession(sessionFile, '新出现的');

    await expect(restoreSession(item.path)).rejects.toThrow();
    expect(await listTrash()).toHaveLength(1);
    expect(await fs.readFile(sessionFile, 'utf-8')).toContain('新出现的');
  });

  it('用原位置路径也能恢复（删除后的「撤销」只能拿到这个路径）', async () => {
    await writeSession(sessionFile, '撤销回来的');
    await trashSession(sessionFile);
    expect(await listTrash()).toHaveLength(1);

    // 关键：传的不是箱内路径
    await restoreSession(sessionFile);

    expect(await fs.readFile(sessionFile, 'utf-8')).toContain('撤销回来的');
    expect(await listTrash()).toEqual([]);
  });

  it('用原位置路径也能彻底删除', async () => {
    await writeSession(sessionFile);
    await trashSession(sessionFile);

    await purgeSession(sessionFile);

    expect(await listTrash()).toEqual([]);
  });
});

describe('彻底删除', () => {
  it('只删回收箱里的那一条', async () => {
    await writeSession(sessionFile);
    await trashSession(sessionFile);
    const [item] = await listTrash();

    await purgeSession(item.path);

    expect(await listTrash()).toEqual([]);
  });

  it('清空回收箱返回条数', async () => {
    const a = await writeSession(path.join(projectDir, 'a.jsonl'));
    const b = await writeSession(path.join(projectDir, 'b.jsonl'));
    await trashSession(a);
    await trashSession(b);

    expect(await emptyTrash()).toBe(2);
    expect(await listTrash()).toEqual([]);
  });
});

describe('保留期', () => {
  it('只清过期条目，未过期的留着', async () => {
    const oldFile = await writeSession(path.join(projectDir, 'old.jsonl'), '过期的');
    const freshFile = await writeSession(path.join(projectDir, 'fresh.jsonl'), '还在期内');
    await trashSession(oldFile);
    await trashSession(freshFile);

    const stale = (await listTrash()).find(i => i.path.includes('old.jsonl'))!;
    const longAgo = new Date(Date.now() - TRASH_RETENTION_MS - 24 * 60 * 60 * 1000);
    await fs.utimes(stale.path, longAgo, longAgo);

    expect(await sweepTrash()).toBe(1);

    const remaining = await listTrash();
    expect(remaining.map(i => i.preview)).toEqual(['还在期内']);
  });

  it('刚好卡在保留期内的不会被清掉', async () => {
    await writeSession(sessionFile);
    await trashSession(sessionFile);

    const [item] = await listTrash();
    // 距到期还有一天
    expect(await sweepTrash(item.deletedAt + TRASH_RETENTION_MS - 24 * 60 * 60 * 1000)).toBe(0);
  });
});

describe('路径穿越防护', () => {
  it('拒绝传入会话目录之外的路径', async () => {
    const outside = path.join(tempHome, 'evil.jsonl');
    await expect(trashSession(outside)).rejects.toThrow('invalid path');
  });

  it('拒绝两个根目录之外的路径', async () => {
    const outside = path.join(tempHome, 'evil.jsonl');
    await expect(restoreSession(outside)).rejects.toThrow('invalid path');
    await expect(purgeSession(outside)).rejects.toThrow('invalid path');
  });

  it('原位置没有对应的回收箱条目时失败，而不是去动别的文件', async () => {
    // 现在 sessions/ 下的路径会被当作「原位置」接受，所以要确保对不上时是明确报错
    await writeSession(sessionFile, '从没被删过');

    await expect(restoreSession(sessionFile)).rejects.toThrow();
    expect(await fs.readFile(sessionFile, 'utf-8')).toContain('从没被删过');
  });

  it('拒绝非 .jsonl 文件', async () => {
    const notes = path.join(projectDir, 'notes.txt');
    await fs.mkdir(projectDir, { recursive: true });
    await fs.writeFile(notes, 'x', 'utf-8');
    await expect(trashSession(notes)).rejects.toThrow('invalid path');
  });
});
