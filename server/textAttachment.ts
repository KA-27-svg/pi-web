import * as path from 'path';
import * as fs from 'fs/promises';
import { resolveWithin } from './browse.js';

/** 单个文本文件最多内联多少字符。再多就让 agent 自己去读，别把 prompt 撑爆。 */
export const MAX_INLINE_BYTES = 100 * 1024;

/** 图片要整份读出来转 base64，给一个更宽松但仍有上限的门槛 */
export const MAX_IMAGE_READ_BYTES = 20 * 1024 * 1024;

/** 嗅探只看开头这么多字节：文件尾部的 NUL 不该影响判断（比如被追加过数据） */
const SNIFF_BYTES = 8000;

/** 图片扩展名 → MIME。名单窄一点：只收 provider 普遍接受的格式。 */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/**
 * 已知的二进制扩展名（图片除外，图片单独处理）。
 * 先按扩展名挡一道，省掉一次读取，也避免某些二进制碰巧前 8000 字节没有 NUL 就漏过去。
 */
const BINARY_EXTENSIONS = new Set([
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.rar', '.7z', '.tar',
  '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.odt', '.ods', '.odp',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class', '.o', '.a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.ico', '.tif', '.tiff', '.avif',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.flac', '.wav', '.webm',
  '.sqlite', '.db', '.mdb',
]);

/** 开头一段里有 NUL 就当作二进制——这是最省事也最准的启发式 */
export function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, SNIFF_BYTES).includes(0);
}

/** 调用方要按 kind 分流：文本内联、图片走原生 images、二进制只给路径 */
export type AttachmentContent =
  | { kind: 'text'; text: string; truncated: boolean; bytes: number }
  | { kind: 'image'; data: string; mimeType: string; bytes: number }
  | { kind: 'binary'; bytes: number };

/**
 * 把请求里的路径解析成一个可以读的绝对路径。
 *
 * 两种情况放行：
 *  - 工作目录内的相对路径（浏览工作目录那条路）
 *  - **用户刚在系统对话框里亲手选过的**绝对路径
 * 其余绝对路径一律拒绝——否则这个接口就成了任意文件读取。
 */
export function resolveAttachment(
  cwd: string,
  requested: unknown,
  allowsAbsolute: (target: string) => boolean
): string {
  const raw = typeof requested === 'string' ? requested : '';

  if (path.isAbsolute(raw)) {
    if (!allowsAbsolute(raw)) throw new Error('只能读取你在文件选择框里选过的文件');
    return path.resolve(raw);
  }

  return resolveWithin(cwd, raw);
}

async function readBytes(target: string, maxBytes: number): Promise<{ buffer: Buffer; bytes: number }> {
  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) throw new Error('文件不存在');

  const length = Math.min(stat.size, maxBytes);
  const handle = await fs.open(target, 'r');
  try {
    const buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, 0);
    return { buffer, bytes: stat.size };
  } finally {
    await handle.close();
  }
}

/**
 * 读一个附件，按类型给出不同的结果。
 *
 * 文本 → 直接内联进 prompt；图片 → base64 交给前端走 `prompt.images`；
 * 二进制 → 只报大小，让 agent 自己用工具处理（docx / pdf 得靠 pandoc 之类的）。
 */
export async function readAttachment(
  absolutePath: string,
  maxBytes: number = MAX_INLINE_BYTES
): Promise<AttachmentContent> {
  const extension = path.extname(absolutePath).toLowerCase();
  const imageMime = IMAGE_MIME[extension];

  if (imageMime) {
    const { buffer, bytes } = await readBytes(absolutePath, MAX_IMAGE_READ_BYTES);
    if (bytes > MAX_IMAGE_READ_BYTES) {
      throw new Error(`图片超过 ${Math.round(MAX_IMAGE_READ_BYTES / 1024 / 1024)} MB，请先压缩`);
    }
    return { kind: 'image', data: buffer.toString('base64'), mimeType: imageMime, bytes };
  }

  if (BINARY_EXTENSIONS.has(extension)) {
    const stat = await fs.stat(absolutePath).catch(() => null);
    if (!stat?.isFile()) throw new Error('文件不存在');
    return { kind: 'binary', bytes: stat.size };
  }

  const { buffer, bytes } = await readBytes(absolutePath, maxBytes);
  if (looksBinary(buffer)) return { kind: 'binary', bytes };

  return {
    kind: 'text',
    text: buffer.toString('utf-8'),
    truncated: bytes > buffer.length,
    bytes,
  };
}
