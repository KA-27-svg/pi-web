/** 上传成功后桥接回报的落盘信息 */
export interface UploadedFile {
  path: string;
  /** 相对工作目录的路径，写进消息里用这个 */
  relativePath: string;
  name: string;
  bytes: number;
}

/** 待发送的附件。上传是异步的，所以先占个位再补上路径。 */
export interface PendingAttachment {
  id: string;
  name: string;
  bytes: number;
  /** 上传成功后才有：相对工作目录的路径 */
  relativePath?: string;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

/** 文件大小。给 chip 用，只要够读，不追求精确。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  if (unit === 0) return `${Math.round(value)} ${units[unit]}`;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * 把附件路径拼进消息。
 *
 * pi 的 RPC 没有附件字段（只有 images），所以文件只能靠「告诉 agent 路径」——
 * 和 Codex 的 /mention 是同一个思路：agent 有 read/bash，自己会去读。
 * 路径放在正文之前，模型先看到有哪些文件，再看到要它做什么。
 */
export function buildPromptWithAttachments(text: string, relativePaths: string[]): string {
  const refs = relativePaths.filter(Boolean).map(p => `[附件] ${p}`);
  if (refs.length === 0) return text;

  const head = refs.join('\n');
  const body = text.trim();
  return body ? `${head}\n\n${body}` : `${head}\n\n（请读取以上附件）`;
}

/**
 * 读成 base64 供 WebSocket 传输。
 * 分块拼接而不是 `String.fromCharCode(...bytes)`：后者在大文件上会把调用栈撑爆。
 */
export async function readFileAsBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
