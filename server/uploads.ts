import * as path from 'path';
import * as fs from 'fs/promises';

/** 上传落盘目录（相对工作目录）。挑一个明显的名字，方便 agent 和用户都认得出。 */
export const UPLOAD_DIR = '.pi-web-uploads';
/** 单文件上限。base64 走 WebSocket，太大既慢又容易把内存顶爆。 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const MAX_NAME_LENGTH = 120;
const TOO_LARGE = `文件太大，超过 ${MAX_UPLOAD_BYTES / 1024 / 1024} MB 上限`;

/**
 * 净化文件名。
 *
 * 这是防路径穿越的第一道闸：浏览器给的名字完全不可信，`../../.ssh/authorized_keys`
 * 也是合法的 File.name。只取最后一段、去掉前导点，剩下的交给 resolveUploadTarget 兜底。
 */
export function safeFileName(raw: unknown): string {
  if (typeof raw !== 'string') return 'file';

  const base = raw.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    // 控制字符要清掉（文件名里混进去会让后续的路径判断很微妙），这里是有意为之
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/^\.+/, '')
    .trim();

  return cleaned.slice(0, MAX_NAME_LENGTH).trim() || 'file';
}

/** 重名时在扩展名前追加序号，绝不覆盖已有文件 */
export function uniqueFileName(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(name)) return name;

  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;

  for (let i = 1; ; i += 1) {
    const candidate = `${stem}-${i}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
}

/** 目标路径必须落在上传目录内——净化之后仍然再校验一次，不靠单一防线 */
export function resolveUploadTarget(cwd: string, fileName: string): string {
  const dir = path.resolve(cwd, UPLOAD_DIR);
  const target = path.resolve(dir, safeFileName(fileName));

  if (!target.startsWith(dir + path.sep)) {
    throw new Error('非法的上传路径');
  }
  return target;
}

/**
 * 把 base64 解成字节。
 *
 * 先按长度估算再解码：一个 200 MB 的文件不该先被分配出来再发现超限。
 */
export function decodeBase64(data: unknown): Buffer {
  if (typeof data !== 'string' || !data) throw new Error('上传内容为空');

  const raw = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  if (!raw) throw new Error('上传内容为空');

  // base64 每 4 个字符约 3 字节（含 padding，估算是上界）
  if (Math.floor((raw.length * 3) / 4) > MAX_UPLOAD_BYTES) throw new Error(TOO_LARGE);

  const buffer = Buffer.from(raw, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error(TOO_LARGE);
  return buffer;
}

export interface UploadResult {
  /** 绝对路径 */
  path: string;
  /** 相对工作目录的路径，写进消息里用这个（短且不暴露用户名） */
  relativePath: string;
  name: string;
  bytes: number;
}

/**
 * 存档上传目录里的 .gitignore（内容为 `*`）。
 * 这样上传的文件不会出现在项目 git status 里，也不用去改项目自己的 .gitignore。
 */
async function ensureGitignore(dir: string): Promise<void> {
  try {
    await fs.writeFile(path.join(dir, '.gitignore'), '*\n', { flag: 'wx' });
  } catch {
    // 已存在就够了
  }
}

/** 把一次上传写进工作目录下的上传目录，返回落盘位置 */
export async function saveUpload(
  cwd: string,
  rawName: unknown,
  data: unknown
): Promise<UploadResult> {
  const dir = path.resolve(cwd);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) throw new Error(`工作目录不存在：${dir}`);

  const buffer = decodeBase64(data);

  const uploadDir = path.join(dir, UPLOAD_DIR);
  await fs.mkdir(uploadDir, { recursive: true });
  await ensureGitignore(uploadDir);

  const name = uniqueFileName(safeFileName(rawName), await fs.readdir(uploadDir));
  const target = path.join(uploadDir, name);

  // wx：万一上面的去重被别人抢先，这里直接失败而不是覆盖
  await fs.writeFile(target, buffer, { flag: 'wx' });

  return {
    path: target,
    relativePath: `${UPLOAD_DIR}/${name}`,
    name,
    bytes: buffer.length,
  };
}
