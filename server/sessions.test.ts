import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  deleteSession,
  listSessions as readSessions,
  readSessionCwdSync,
  renameSession,
  sessionsRoot,
} from './sessions';

/** 大多数用例只关心列表本身；total 另有专门用例 */
const listSessions = async (limit?: number) => (await readSessions(limit)).sessions;

const SESSION_ID = 'sess-1';
const LAST_ENTRY_ID = 'entry-1';

let tempHome: string;
let projectDir: string;
let sessionFile: string;

const header = () => JSON.stringify({ type: 'session', id: SESSION_ID, cwd: 'C:\\demo' });
const userMessage = (text: string, id = LAST_ENTRY_ID) =>
  JSON.stringify({ type: 'message', id, parentId: null, message: { role: 'user', content: text } });

const writeLines = (file: string, lines: string[]) => fs.writeFile(file, lines.join('\n'), 'utf-8');

async function readEntries(file: string) {
  const raw = await fs.readFile(file, 'utf-8');
  return raw.split('\n').filter(Boolean).map(l => JSON.parse(l));
}

beforeEach(async () => {
  tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-sessions-'));
  process.env.PI_SESSIONS_ROOT = tempHome;
  projectDir = path.join(tempHome, 'proj-abc');
  await fs.mkdir(projectDir, { recursive: true });
  sessionFile = path.join(projectDir, '2026-01-01T00-00-00-000Z_aaa.jsonl');
});

afterEach(async () => {
  delete process.env.PI_SESSIONS_ROOT;
  await fs.rm(tempHome, { recursive: true, force: true });
});

describe('sessionsRoot', () => {
  it('跟随 PI_SESSIONS_ROOT', () => {
    expect(sessionsRoot()).toBe(tempHome);
  });
});

describe('listSessions', () => {
  it('读取会话头与首条用户消息', async () => {
    await writeLines(sessionFile, [header(), userMessage('第一条消息')]);

    const sessions = await listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      path: sessionFile,
      id: SESSION_ID,
      cwd: 'C:\\demo',
      preview: '第一条消息',
    });
    expect(typeof sessions[0].updatedAt).toBe('number');
  });

  it('跳过以尖括号开头的注入内容，取真正的用户消息', async () => {
    await writeLines(sessionFile, [
      header(),
      userMessage('<skill-injected>系统注入内容</skill-injected>', 'inj'),
      userMessage('真实问题', 'real'),
    ]);

    expect((await listSessions())[0].preview).toBe('真实问题');
  });

  it('头部被超长注入内容撑满时仍能找到用户消息（多字节边界）', async () => {
    // 每个「中」占 3 字节，64KB 分块边界必然落在字符中间，用来验证跨块解码
    const injected = `<skill>${'中'.repeat(40 * 1024)}</skill>`;
    await writeLines(sessionFile, [
      header(),
      userMessage(injected, 'inj'),
      userMessage('真正的第一条问题', 'real'),
    ]);

    const [session] = await listSessions();
    expect(session.preview).toBe('真正的第一条问题');
  });

  it('忽略会话文件里的垃圾行', async () => {
    await writeLines(sessionFile, ['不是 JSON', '{"type":"session"', header(), userMessage('OK')]);

    const sessions = await listSessions();
    expect(sessions.map(s => s.path)).toEqual([sessionFile]);
    expect(sessions[0].id).toBe(SESSION_ID);
    expect(sessions[0].preview).toBe('OK');
  });

  it('没有会话头的文件仍会列出，以便在侧栏里删掉', async () => {
    const broken = path.join(projectDir, 'broken.jsonl');
    await fs.writeFile(broken, '{ not json at all', 'utf-8');

    const sessions = await listSessions();
    const corrupt = sessions.find(s => s.path === broken);
    expect(corrupt).toBeDefined();
    expect(corrupt?.preview).toBe('');
    // id 回退为文件名，界面上会显示为未命名对话
    expect(corrupt?.id).toBe('broken');
  });

  it('按修改时间倒序并按 limit 截断', async () => {
    const files: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const file = path.join(projectDir, `2026-01-0${i + 1}T00-00-00-000Z_x${i}.jsonl`);
      await writeLines(file, [header(), userMessage(`消息 ${i}`)]);
      const time = new Date(Date.UTC(2026, 0, i + 1));
      await fs.utimes(file, time, time);
      files.push(file);
    }

    const sessions = await listSessions(2);
    expect(sessions).toHaveLength(2);
    expect(sessions.map(s => s.preview)).toEqual(['消息 2', '消息 1']);
  });

  it('会话目录不存在时返回空数组', async () => {
    process.env.PI_SESSIONS_ROOT = path.join(tempHome, 'does-not-exist');
    expect(await listSessions()).toEqual([]);
  });

  it('total 反映磁盘上的总数，即使列表被截断', async () => {
    const files: string[] = [];
    for (let i = 0; i < 5; i += 1) {
      const file = path.join(projectDir, `2026-02-0${i + 1}T00-00-00-000Z_y${i}.jsonl`);
      await writeLines(file, [header(), userMessage(`消息 ${i}`)]);
      files.push(file);
    }

    const listed = await readSessions(2);

    expect(listed.sessions).toHaveLength(2);
    expect(listed.total).toBe(5);
  });
});

describe('readSessionCwdSync', () => {
  it('读出会话头里记录的 cwd', async () => {
    await writeLines(sessionFile, [header(), userMessage('问题')]);

    expect(readSessionCwdSync(sessionFile)).toBe('C:\\demo');
  });

  it('头部损坏或没有 cwd 时返回 null', async () => {
    const broken = path.join(projectDir, 'broken.jsonl');
    await fs.writeFile(broken, 'not json at all', 'utf-8');
    expect(readSessionCwdSync(broken)).toBeNull();

    const noCwd = path.join(projectDir, 'no-cwd.jsonl');
    await writeLines(noCwd, [JSON.stringify({ type: 'session', id: 'x' })]);
    expect(readSessionCwdSync(noCwd)).toBeNull();
  });

  it('拒绝会话目录之外的路径', () => {
    expect(readSessionCwdSync(path.join(os.tmpdir(), 'unrelated.jsonl'))).toBeNull();
  });
});

describe('renameSession', () => {
  it('在末尾追加 session_info，parentId 指向最后一条 entry', async () => {
    await writeLines(sessionFile, [header(), userMessage('原始消息')]);

    await renameSession(sessionFile, '我的新名字');

    const entries = await readEntries(sessionFile);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ type: 'session', id: SESSION_ID });
    expect(entries[1]).toMatchObject({ type: 'message', id: LAST_ENTRY_ID });
    expect(entries[2]).toMatchObject({ type: 'session_info', parentId: LAST_ENTRY_ID, name: '我的新名字' });
    expect(typeof entries[2].id).toBe('string');
    expect((await listSessions())[0].name).toBe('我的新名字');
  });

  it('文件末尾缺少换行时补上，不破坏原有行', async () => {
    await writeLines(sessionFile, [header(), userMessage('原始消息')]);

    await renameSession(sessionFile, '补换行');

    const entries = await readEntries(sessionFile);
    expect(entries).toHaveLength(3);
    expect(entries[1].message.content).toBe('原始消息');
  });

  it('多次重命名取最后一次', async () => {
    await writeLines(sessionFile, [header(), userMessage('原始消息')]);

    await renameSession(sessionFile, '第一次');
    await renameSession(sessionFile, '第二次');

    expect((await listSessions())[0].name).toBe('第二次');
  });

  it('文件很长时仍能从尾部读到最新名字', async () => {
    const big = JSON.stringify({
      type: 'message',
      id: 'big',
      parentId: LAST_ENTRY_ID,
      message: { role: 'assistant', content: 'y'.repeat(40 * 1024) },
    });
    await writeLines(sessionFile, [header(), userMessage('问题'), big]);

    await renameSession(sessionFile, '尾部改名');

    expect((await listSessions())[0].name).toBe('尾部改名');
  });
});

describe('deleteSession', () => {
  it('删除后不再出现在列表里', async () => {
    await writeLines(sessionFile, [header(), userMessage('待删除')]);
    expect(await listSessions()).toHaveLength(1);

    await deleteSession(sessionFile);

    expect(await listSessions()).toEqual([]);
    await expect(fs.stat(sessionFile)).rejects.toThrow();
  });
});

describe('路径穿越防护', () => {
  const reject = async (target: string) => {
    await expect(renameSession(target, 'x')).rejects.toThrow('invalid session path');
    await expect(deleteSession(target)).rejects.toThrow('invalid session path');
  };

  it('拒绝会话目录之外的路径', async () => {
    await reject(path.join(tempHome, '..', '..', 'evil.jsonl'));
  });

  it('拒绝非 .jsonl 文件', async () => {
    await reject(path.join(projectDir, 'notes.txt'));
  });

  it('拒绝与会话目录无关的路径', async () => {
    await reject(path.join(os.tmpdir(), 'unrelated.jsonl'));
  });

  it('前缀相同但不是子目录的路径也要拒绝', async () => {
    // <root>-evil 与 <root> 共享前缀，字符串 startsWith 检查会误判
    await reject(`${tempHome}-evil${path.sep}x.jsonl`);
  });
});
