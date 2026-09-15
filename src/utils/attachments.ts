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
  /** 文件：读到的文本内容，会直接内联进 prompt（二进制文件没有这个） */
  content?: string;
  /** content 只是文件开头（超过内联上限） */
  truncated?: boolean;
  /** 图片：base64（不带 data URL 前缀）与 MIME，直接进 prompt.images */
  data?: string;
  mimeType?: string;
  dataUrl?: string;
}

/** 发送时每个文件附件带的信息 */
export interface PromptFile {
  name: string;
  relativePath: string;
  content?: string;
  truncated?: boolean;
}

/** 输入框交给发送逻辑的一整份草稿 */
export interface PromptDraft {
  text: string;
  images: { name: string; data: string; mimeType: string }[];
  files: PromptFile[];
}

/** 单张图片的字节兑底上限。缩放之后正常都远低于它，只在无法解码时才拦。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 最长边上限。
 *
 * provider 的 token 成本随像素增长（Anthropic 是 `宽×高÷750`）：
 * 一张 4000×3000 的截图约 16000 tokens，按 $10/M 就是一张图 $0.16。
 * 而且图片超过 20 张时 Claude 还会把单图尺寸卡到 2000px。所以统一压到 2000。
 *
 * 注：pi 自己的 images.autoResize 只作用于 CLI 的 @file 附件和 read 工具，
 * RPC 传进去的 images 是原样透传的（见 rpc-mode.js），所以得我们自己管。
 */
export const MAX_IMAGE_EDGE = 2000;

/** 附件路径行的前缀，也是历史解析时的识别依据 */
export const ATTACHMENT_PREFIX = '[附件] ';

/** 只发了附件、没写正文时自动补的一句；展示时会去掉，免得气泡里出现系统腔 */
export const ATTACHMENT_INSTRUCTION = '（请读取以上附件）';

/** 同上，但用于「只有图片、没有正文」的情况 */
export const IMAGE_ONLY_INSTRUCTION = '请看这些图片。';

/** 内容被截断时跟在围栏后面的一句；展示时一并去掉 */
export const TRUNCATED_NOTE = '（以上只是开头，完整内容请用 read 工具读取该文件）';

/** 图片走 pi 原生附件，文件走「把路径告诉 agent」 */
export function isImageFile(file: File): boolean {
  return typeof file.type === 'string' && file.type.startsWith('image/');
}

/** 从路径里取文件名，给文件卡片显示用 */
export function baseName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

/**
 * 从消息文本里取回附件路径，并把附件那几行从正文里去掉。
 *
 * pi 的会话文件里，用户消息只是纯文本（RPC 没有通用附件字段），所以展示时得
 * 反过来解析一遍：这样刷新页面后重新加载的历史也能渲染成卡片，而不是一大块代码。
 */
export function parseFileAttachments(content: string): { text: string; paths: string[] } {
  const paths: string[] = [];
  const kept: string[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();

    if (trimmed.startsWith(ATTACHMENT_PREFIX)) {
      const path = trimmed.slice(ATTACHMENT_PREFIX.length).trim();
      if (path) paths.push(path);

      // 紧随其后的围栏块是内联进来的文件内容，展示时不必再铺一遍
      const opener = lines[i + 1]?.trim();
      if (opener && /^`{3,}$/.test(opener)) {
        i += 1;
        while (i + 1 < lines.length && lines[i + 1].trim() !== opener) i += 1;
        i += 1;
        if (lines[i + 1]?.trim() === TRUNCATED_NOTE) i += 1;
      }
      continue;
    }

    kept.push(lines[i]);
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
 * 给内联内容挑围栏：比内容里最长的连续反引号再长一个。
 * 否则文件本身写着 ``` 就会把围栏提前关掉。
 */
function fenceFor(content: string): string {
  const longest = (content.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * 把附件拼进消息。
 *
 * 文本文件把**内容直接内联**进来，模型一眼就看到，不必先花一轮去调 read；
 * 二进制文件（docx / pdf 等）只能给路径，由 agent 自己用工具处理。
 * 图片不走这里——它们走 `prompt.images` 原生通道。
 */
export function buildPromptWithAttachments(text: string, files: PromptFile[]): string {
  const refs = files
    .filter(file => file.relativePath)
    .map(file => {
      const header = `${ATTACHMENT_PREFIX}${file.relativePath}`;
      if (file.content === undefined) return header;

      const fence = fenceFor(file.content);
      const block = `${header}\n${fence}\n${file.content}\n${fence}`;
      return file.truncated ? `${block}\n${TRUNCATED_NOTE}` : block;
    });

  if (refs.length === 0) return text;

  const head = refs.join('\n');
  const body = text.trim();
  return body ? `${head}\n\n${body}` : `${head}\n\n${ATTACHMENT_INSTRUCTION}`;
}

/**
 * 纯计算：这张图要不要重编码，重编码后多大。
 *
 * 两个触发条件分别对应两个真问题：尺寸（token 成本 + provider 尺寸限制）
 * 和体积（provider 的字节上限）。
 */
export function planImageResize(
  width: number,
  height: number,
  bytes: number
): { width: number; height: number; reencode: boolean } {
  const longest = Math.max(width, height);
  const reencode = longest > MAX_IMAGE_EDGE || bytes > MAX_IMAGE_BYTES;
  if (!reencode) return { width, height, reencode: false };

  const scale = Math.min(1, MAX_IMAGE_EDGE / longest);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    reencode: true,
  };
}

/** 把图片文件解成像素。环境不支持（Node / jsdom）时返回 null，由上屋降级处理。 */
async function decodeImage(
  file: File
): Promise<{ source: ImageBitmap; width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;

  try {
    const source = await createImageBitmap(file);
    return { source, width: source.width, height: source.height };
  } catch {
    // 损坏的图片、或者浏览器不支持的格式
    return null;
  }
}

/** 用 canvas 重采样并导出 JPEG。导出前铺白底：JPEG 没有透明通道，透明区会变黑。 */
async function redrawToJpeg(source: ImageBitmap, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('这个浏览器不支持缩小图片');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  const blob = await new Promise<Blob | null>(resolve =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  );
  if (!blob) throw new Error('图片转换失败');
  return blob;
}

/**
 * 把图片文件准备成可以直接发给 pi 的形式。
 *
 * 尺寸和体积都合规就原样发（不重编码意味着不掉画质、不丢动画、不失透明）；
 * 否则缩到 MAX_IMAGE_EDGE 并转 JPEG。
 */
export async function prepareImageAttachment(
  file: File
): Promise<{ data: string; mimeType: string; dataUrl: string }> {
  const decoded = await decodeImage(file);
  const plan = decoded
    ? planImageResize(decoded.width, decoded.height, file.size)
    : { width: 0, height: 0, reencode: file.size > MAX_IMAGE_BYTES };

  if (!plan.reencode) {
    const data = await readFileAsBase64(file);
    const mimeType = file.type || 'image/png';
    return { data, mimeType, dataUrl: `data:${mimeType};base64,${data}` };
  }

  // 连尺寸都读不出来（环境不支持或文件损坏），只能退回“请你先压缩”
  if (!decoded) {
    throw new Error(`图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB，请先压缩`);
  }

  const blob = await redrawToJpeg(decoded.source, plan.width, plan.height);
  decoded.source.close?.();

  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error('缩放后仍然超出上限，请先压缩');
  }

  const data = await readFileAsBase64(blob);
  const mimeType = blob.type || 'image/jpeg';
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
