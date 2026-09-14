import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { StringDecoder } from 'string_decoder';

export const SESSIONS_ROOT = path.join(os.homedir(), '.pi', 'agent', 'sessions');

export interface SessionSummary {
  path: string;
  id: string;
  name?: string;
  preview: string;
  updatedAt: number;
  cwd?: string;
}

/** 只允许操作会话目录内的文件，避免路径穿越 */
function resolveSessionPath(sessionPath: string): string {
  const root = path.resolve(SESSIONS_ROOT) + path.sep;
  const resolved = path.resolve(sessionPath);
  if (!resolved.startsWith(root) || !resolved.endsWith('.jsonl')) {
    throw new Error('invalid session path');
  }
  return resolved;
}

function randomEntryId(): string {
  return Math.random().toString(16).slice(2, 10);
}

/**
 * 重命名历史会话：pi 只能给当前会话改名的 set_session_name，
 * 因此沿用它的存储方式，在 JSONL 末尾追加一条 session_info，
 * parentId 指向最后一条 entry 以保证树链完整。
 */
export async function renameSession(sessionPath: string, name: string): Promise<void> {
  const target = resolveSessionPath(sessionPath);
  const raw = await fs.readFile(target, 'utf-8');

  let parentId: string | null = null;
  const lines = raw.split('\n');
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line || line.charCodeAt(0) !== 123) continue;
    try {
      const entry = JSON.parse(line);
      if (typeof entry?.id === 'string') {
        parentId = entry.id;
        break;
      }
    } catch {
      // 忽略无法解析的行
    }
  }

  const entry = {
    type: 'session_info',
    id: randomEntryId(),
    parentId,
    timestamp: new Date().toISOString(),
    name,
  };
  const prefix = raw.length === 0 || raw.endsWith('\n') ? '' : '\n';
  await fs.appendFile(target, `${prefix}${JSON.stringify(entry)}\n`, 'utf-8');
}

export async function deleteSession(sessionPath: string): Promise<void> {
  await fs.unlink(resolveSessionPath(sessionPath));
}

// 会话文件可能有几十 MB。列表只需要三样东西：会话头（id/cwd）、首条真实用户消息（标题）、
// 以及最新的 session_info（重命名）。前两者在文件头部，最后一个在文件尾部，因此头尾分开取。
const SCAN_CHUNK_BYTES = 64 * 1024;
const TAIL_BYTES = 32 * 1024;
// 头部扫描上限：防御没有用户消息的会话把整个文件读完
const HEAD_BUDGET_BYTES = 2 * 1024 * 1024;

// 用宽松正则而非字面量前缀：pi 的 JSON 序列化只要多一个空格，startsWith 匹配就会静默失效
const SESSION_HEADER_RE = /^\{\s*"type"\s*:\s*"session"\s*[,}]/;
const SESSION_INFO_RE = /^\{\s*"type"\s*:\s*"session_info"\s*[,}]/;
const MESSAGE_RE = /^\{\s*"type"\s*:\s*"message"\s*[,}]/;
const USER_ROLE_RE = /"role"\s*:\s*"user"/;

function firstUserPreview(content: unknown): string {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c: any) => c?.text || '').join(' ')
        : '';
  const clean = text.replace(/\s+/g, ' ').trim();
  // 跳过 skill 注入这类以尖括号开头的系统内容
  return clean && !clean.startsWith('<') ? clean.slice(0, 90) : '';
}

interface HeadScan {
  id: string;
  cwd?: string;
  name?: string;
  preview: string;
}

/**
 * 逐块扫描文件头部，拿到会话头与首条真实用户消息就停，而不是读满整个文件。
 * 用 StringDecoder 而不是直接 toString：块边界可能落在多字节字符中间。
 */
async function scanHead(file: string): Promise<HeadScan> {
  const handle = await fs.open(file, 'r');
  const decoder = new StringDecoder('utf-8');
  const buffer = Buffer.alloc(SCAN_CHUNK_BYTES);
  let position = 0;
  let pending = '';
  let id = '';
  let cwd: string | undefined;
  let name: string | undefined;
  let preview = '';

  const consume = (lines: string[]) => {
    for (const line of lines) {
      if (line.charCodeAt(0) !== 123 /* { */) continue;

      if (!id && SESSION_HEADER_RE.test(line)) {
        try {
          const header = JSON.parse(line);
          id = header.id ?? '';
          cwd = header.cwd || undefined;
        } catch {}
        continue;
      }

      if (SESSION_INFO_RE.test(line)) {
        try {
          name = JSON.parse(line).name || undefined;
        } catch {}
        continue;
      }

      if (!preview && MESSAGE_RE.test(line) && USER_ROLE_RE.test(line)) {
        let entry: any;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        if (entry?.message?.role !== 'user') continue;
        preview = firstUserPreview(entry.message.content);
      }
    }
  };

  try {
    while (position < HEAD_BUDGET_BYTES) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        pending += decoder.end();
        break;
      }
      position += bytesRead;

      const text = pending + decoder.write(buffer.subarray(0, bytesRead));
      const lines = text.split('\n');
      pending = lines.pop() ?? '';
      consume(lines);

      // 会话头和首条用户消息都拿到了，后面的内容对摘要没用
      if (id && preview) break;
    }
    if (pending) consume([pending]);
  } finally {
    await handle.close();
  }

  return { id, cwd, name, preview };
}

/** 只读文件尾部，用于取最后一条 session_info（重命名追加在末尾） */
async function readTail(file: string): Promise<string> {
  const handle = await fs.open(file, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    if (buffer.length > 0) await handle.read(buffer, 0, buffer.length, start);

    let text = buffer.toString('utf-8');
    // 起始位置可能落在半行上，丢掉残缺的首行
    if (start > 0) {
      const firstBreak = text.indexOf('\n');
      text = firstBreak === -1 ? '' : text.slice(firstBreak + 1);
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function readSessionSummary(
  file: string,
  mtimeMs: number
): Promise<SessionSummary> {
  const { id, cwd, name: headName, preview } = await scanHead(file);

  // 重命名会追加新的 session_info，尾部那条才代表最新名字
  let name = headName;
  for (const line of (await readTail(file)).split('\n')) {
    if (!SESSION_INFO_RE.test(line)) continue;
    try {
      name = JSON.parse(line).name || undefined;
    } catch {}
  }

  return {
    path: file,
    id: id || path.basename(file).replace(/^[^_]*_/, '').replace(/\.jsonl$/, ''),
    name,
    preview,
    updatedAt: mtimeMs,
    cwd,
  };
}

/**
 * 会话按工作目录分目录存放。侧栏像 Codex 一样展示全部历史，
 * 因此扫全部子目录后按修改时间取最近的若干条。
 */
export async function listSessions(limit = 60): Promise<SessionSummary[]> {
  let dirs: string[];
  try {
    const entries = await fs.readdir(SESSIONS_ROOT, { withFileTypes: true });
    dirs = entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(SESSIONS_ROOT, entry.name));
  } catch {
    return [];
  }

  const candidates: { full: string; mtimeMs: number }[] = [];
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
        candidates.push({ full, mtimeMs: stat.mtimeMs });
      } catch {
        // 忽略无法 stat 的文件
      }
    }
  }

  const recent = candidates
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  const summaries: SessionSummary[] = [];
  for (const file of recent) {
    try {
      summaries.push(await readSessionSummary(file.full, file.mtimeMs));
    } catch {
      // 跳过损坏或不可读的会话
    }
  }
  return summaries;
}
