import type { AttachmentContent, DirListing } from '../types/pi';
import { readFileAsBase64, type UploadedFile } from '../utils/attachments';
import type { PiBridge } from './piBridge';

/**
 * 附件相关的桥接调用。
 *
 * 桥接跑在同一台机器上，所以「选文件」不需要复制任何字节——它替用户弹原生对话框、
 * 把真实路径拿回来，文件原地不动。只有拖拽/粘贴进来的文件（浏览器不给路径）
 * 才真的要把字节传上去。
 */
export function createAttachmentActions({ request }: PiBridge) {
  /** 把文件交给桥接落到工作目录，拿回相对路径 */
  const uploadFile = async (file: File): Promise<UploadedFile> => {
    const data = await readFileAsBase64(file);
    return request<UploadedFile>('upload_file', { name: file.name, data });
  };

  /** 列工作目录。给「从工作目录选文件」用——只读路径，不传字节 */
  const listDir = (relativePath = ''): Promise<DirListing> =>
    request<DirListing>('list_dir', { path: relativePath });

  /** 读一个附件：文本拿内容、图片拿 base64、二进制只要大小 */
  const readAttachment = (filePath: string): Promise<AttachmentContent> =>
    request<AttachmentContent>('read_attachment', { path: filePath });

  /** 弹系统原生的文件选择框，拿回绝对路径。用户取消时返回空数组 */
  const pickFile = async (imagesOnly = false): Promise<string[]> => {
    const result = await request<{ paths?: string[] }>('pick_file', { imagesOnly });
    return result.paths ?? [];
  };

  /**
   * 用系统默认程序打开一个附件。
   * 路径只允许工作目录内的，或用户刚在文件选择框里选过的。
   */
  const openAttachment = (filePath: string): Promise<void> =>
    request<unknown>('open_attachment', { path: filePath }).then(() => undefined);

  return { uploadFile, listDir, readAttachment, pickFile, openAttachment };
}
