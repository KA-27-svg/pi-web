/** 上传成功后桥接回报的落盘信息 */
export interface UploadedFile {
  path: string;
  /** 相对工作目录的路径，写进消息里用这个 */
  relativePath: string;
  name: string;
  bytes: number;
}

/** 待发送的附件。图片直接带 base64 发给 pi，文件先上传换路径。 */
export interface PendingAttachment {
  id: string;
  name: string;
  bytes: number;
  kind: 'image' | 'file';
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  /** 文件：上传成功后的相对路径 */
  relativePath?: string;
  /** 图片：base64（不带 data URL 前缀）与 MIME，直接进 prompt.images */
  data?: string;
  mimeType?: string;
  dataUrl?: string;
}

/** 输入框交给发送逻辑的一整份草稿 */
export interface PromptDraft {
  text: string;
  images: { name: string; data: string; mimeType: string }[];
  files: { name: string; relativePath: string }[];
}

/** 单张图片上限。provider 普遍在 5 MB 上下就拒了，先在客户端挡下来给个明确提示。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** 附件路径行的前缀，也是历史解析时的识别依据 */
export const ATTACHMENT_PREFIX = '[附件] ';

/** 只发了附件、没写正文时自动补的一句；展示时会去掉，免得气泡里出现系统腔 */
export const ATTACHMENT_INSTRUCTION = '（请读取以上附件）';

/** 同上，但用于「只有图片、没有正文」的情况 */
export const IMAGE_ONLY_INSTRUCTION = '请看这些图片。';

/** 图片走 pi 原生附件，文件走「把路径告诉 agent」 */
export function isImageFile(file: File): boolean {
  return typeof file.type === 'string' && file.type.startsWith('image/');
}

/** 从路径里取文件名，给文件卡片显示用 */
export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

/**
 * 从消息文本里取回附件路径，并把那几行从正文里去掉。
 *
 * pi 的会话文件里，用户消息只是带 `[附件] 路径` 的纯文本（RPC 没有通用附件字段），
 * 所以展示时得反过来解析一遍——这样刷新页面后重新加载的历史也能渲染成卡片。
 */
export function parseFileAttachments(content: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  const kept: string[] = [];

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(ATTACHMENT_PREFIX)) {
      const path = trimmed.slice(ATTACHMENT_PREFIX.length).trim();
      if (path) paths.push(path);
      continue;
    }
    kept.push(line);
  }

  let text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (paths.length > 0 && text === ATTACHMENT_INSTRUCTION) text = '';
  return { text, paths };
}

/** 文件大小。给附件条用，只要够读，不追求精确。 */
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
 * 把文件路径拼进消息。
 *
 * 只有**文件**走这条路：pi 的 RPC 没有通用附件字段，只能告诉 agent 路径，
 * 它有 read/bash，自己会去读（和 Codex 的 /mention 一个思路）。
 * 图片走 `prompt.images` 原生通道，不进正文。
 */
export function buildPromptWithAttachments(text: string, relativePaths: string[]): string {
  const refs = relativePaths.filter(Boolean).map(p => `${ATTACHMENT_PREFIX}${p}`);
  if (refs.length === 0) return text;

  const head = refs.join('\n');
  const body = text.trim();
  return body ? `${head}\n\n${body}` : `${head}\n\n${ATTACHMENT_INSTRUCTION}`;
}

/**
 * 把图片文件准备成可以直接发给 pi 的形式。
 *
 * 超过上限就拒绝，而不是发出去等 provider 报错——那个错误信息通常很难懂。
 * （自动压缩是下一步：需要 canvas，先不做。）
 */
export async function prepareImageAttachment(
  file: File
): Promise<{ data: string; mimeType: string; dataUrl: string }> {
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB，请先压缩`);
  }

  const data = await readFileAsBase64(file);
  const mimeType = file.type || 'image/png';
  return { data, mimeType, dataUrl: `data:${mimeType};base64,${data}` };
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
