import * as path from 'path';
import * as fs from 'fs/promises';
import { resolveWithin } from './browse.js';

/** 单个文本文件最多内联多少字符。再多就让 agent 自己去读，别把 prompt 撑爆。 */
export const MAX_INLINE_BYTES = 100 * 1024;

/** 嗅探只看开头这么多字节：文件尾部的 NUL 不该影响判断（比如被追加过数据） */
const SNIFF_BYTES = 8000;

/**
 * 已知的二进制扩展名。
 * 先按扩展名挡一道，省掉一次读取，也避免某些二进制碰巧前 8000 字节没有 NUL 就漏过去。
 */
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff', '.avif',
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.rar', '.7z', '.tar',
  '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt', '.odt', '.ods', '.odp',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.wasm', '.class', '.o', '.a',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.flac', '.wav', '.webm',
  '.sqlite', '.db', '.mdb',
]);

/** 开头一段里有 NUL 就当作二进制——这是最省事也最准的启发式 */
export function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, SNIFF_BYTES).includes(0);
}

export interface TextAttachment {
  text: string;
  /** 文件比内联上限大，内容只取了开头 */
  truncated: boolean;
  /** 文件实际大小，用于告诉用户/模型完整文件多大 */
  bytes: number;
}

/**
 * 把一个文件当文本读出来，供直接内联进 prompt。
 *
 * 返回 null 表示「这是二进制，别内联」——调用方保留路径让 agent 自己处理
 * （docx/pdf 这类要靠 pandoc 或专用工具）。
 *
 * 路径同样限制在工作目录内：这个功能和「浏览工作目录」一样，只读、只在该目录里。
 */
export async function readTextAttachment(
  cwd: string,
  relative: unknown,
  maxBytes: number = MAX_INLINE_BYTES
): Promise<TextAttachment | null> {
  const target = resolveWithin(cwd, relative);

  const stat = await fs.stat(target).catch(() => null);
  if (!stat?.isFile()) throw new Error('文件不存在');

  if (BINARY_EXTENSIONS.has(path.extname(target).toLowerCase())) return null;

  const length = Math.min(stat.size, maxBytes);
  const handle = await fs.open(target, 'r');
  let buffer: Buffer;
  try {
    buffer = Buffer.alloc(length);
    if (length > 0) await handle.read(buffer, 0, length, 0);
  } finally {
    await handle.close();
  }

  if (looksBinary(buffer)) return null;

  return {
    text: buffer.toString('utf-8'),
    truncated: stat.size > length,
    bytes: stat.size,
  };
}
