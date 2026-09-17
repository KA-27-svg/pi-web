import { useCallback, useEffect, useState } from 'react';
import type { AttachmentContent, DirEntry } from '../types/pi';
import {
  base64ToFile,
  baseName,
  isImageFile,
  isImagePath,
  prepareImageAttachment,
  readInlineText,
  type PendingAttachment,
  type UploadedFile,
} from '../utils/attachments';

interface AttachmentSources {
  /** 弹系统原生的文件选择框，拿回绝对路径（不复制文件） */
  onPickFile?: (imagesOnly?: boolean) => Promise<string[]>;
  /** 读附件内容：文本内联、图片 base64、二进制只报大小 */
  onReadAttachment?: (path: string) => Promise<AttachmentContent>;
  /** 落盘通道。只在拖进来一个二进制文件时用得上（那时拿不到路径） */
  onUploadFile?: (file: File) => Promise<UploadedFile>;
}

/**
 * 输入框的附件管理。
 *
 * 四条来源的差异其实很大，这也是它值得单独一块的原因：
 *  - 拖拽 / 粘贴：只有字节，没有路径（浏览器不给）
 *  - 系统对话框：有绝对路径，零复制
 *  - 工作目录：有相对路径，本来就躺在磁盘上
 * 而它们最终都要变成「能发给 pi 的样子」：图片走 base64、文本内联进 prompt、
 * 二进制只给路径。这套转换跟打字、发送没有半点关系。
 */
export function useComposerAttachments({
  onPickFile,
  onReadAttachment,
  onUploadFile,
}: AttachmentSources) {
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [dragging, setDragging] = useState(false);

  const newId = () => `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const patch = useCallback((id: string, changes: Partial<PendingAttachment>) => {
    setAttachments(prev => prev.map(item => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const remove = useCallback((id: string) => {
    setAttachments(prev => prev.filter(item => item.id !== id));
  }, []);

  const clear = useCallback(() => setAttachments([]), []);

  /**
   * 文本文件把内容读出来内联——模型一眼就看到，不必先花一轮去调 read。
   * 读失败也当作普通文件，不影响附件本身。
   */
  const loadContent = useCallback(
    async (id: string, path: string) => {
      if (!onReadAttachment) return;

      try {
        const result = await onReadAttachment(path);
        if (result.kind !== 'text') return;
        patch(id, { content: result.text, truncated: result.truncated, bytes: result.bytes });
      } catch {
        // 读不到就当普通文件处理
      }
    },
    [onReadAttachment, patch]
  );

  /**
   * 处理**文件对象**（拖拽 / 粘贴进来的）。
   *
   * 这些文件只有名字，没有路径——浏览器不会告诉我们。所以：
   *  - 图片：读成 base64 走原生附件，不落盘
   *  - 文本：内容直接在浏览器里读出来内联，**也不落盘**
   *  - 其它（docx / pdf 等二进制）：没办法，只能走落盘通道
   */
  const addFiles = useCallback(
    async (files: Iterable<File>) => {
      for (const file of files) {
        const id = newId();
        const kind = isImageFile(file) ? 'image' : 'file';
        setAttachments(prev => [
          ...prev,
          { id, name: file.name || 'file', bytes: file.size, kind, status: 'loading' },
        ]);

        try {
          if (kind === 'image') {
            const prepared = await prepareImageAttachment(file);
            patch(id, { ...prepared, status: 'ready' });
            continue;
          }

          const inline = await readInlineText(file);
          if (inline) {
            patch(id, { content: inline.text, truncated: inline.truncated, status: 'ready' });
            continue;
          }

          if (!onUploadFile) throw new Error('这个文件需要落盘通道，但当前不可用');
          const uploaded = await onUploadFile(file);
          patch(id, {
            status: 'ready',
            name: uploaded.name,
            bytes: uploaded.bytes,
            path: uploaded.relativePath,
          });
          void loadContent(id, uploaded.relativePath);
        } catch (error) {
          patch(id, { status: 'error', error: (error as Error).message });
        }
      }
    },
    [onUploadFile, loadContent, patch]
  );

  /**
   * 从系统对话框选。**文件一个字节都不复制**——桥接拿回真实路径，我们只是
   * 把路径记下来，需要内容（文本 / 图片）时才去读那一个文件。
   */
  const addFromComputer = useCallback(async () => {
    if (!onPickFile) return;

    let paths: string[];
    try {
      paths = await onPickFile();
    } catch (error) {
      const id = newId();
      // 没有文件名可显示时，把原因本身当成标签——比干巴巴一个「失败」有用
      setAttachments(prev => [
        ...prev,
        {
          id,
          name: (error as Error).message,
          bytes: 0,
          kind: 'file',
          status: 'error',
          error: (error as Error).message,
        },
      ]);
      return;
    }

    for (const absolute of paths) {
      const id = newId();
      const image = isImagePath(absolute);
      setAttachments(prev => [
        ...prev,
        {
          id,
          name: baseName(absolute),
          bytes: 0,
          kind: image ? 'image' : 'file',
          status: 'loading',
        },
      ]);

      try {
        const content = await onReadAttachment?.(absolute);
        if (content?.kind === 'image') {
          // 图片要真的发给模型，所以在浏览器里重新走一遍缩放管线
          const file = base64ToFile(content.data, baseName(absolute), content.mimeType);
          const prepared = await prepareImageAttachment(file);
          patch(id, { ...prepared, bytes: content.bytes, status: 'ready' });
        } else if (content?.kind === 'text') {
          patch(id, {
            path: absolute,
            content: content.text,
            truncated: content.truncated,
            bytes: content.bytes,
            status: 'ready',
          });
        } else {
          patch(id, { path: absolute, bytes: content?.bytes ?? 0, status: 'ready' });
        }
      } catch (error) {
        patch(id, { path: absolute, status: 'error', error: (error as Error).message });
      }
    }
  }, [onPickFile, onReadAttachment, patch]);

  /** 从工作目录挑：文件已经在磁盘上，连内容都不必复制 */
  const addFromWorkspace = useCallback(
    (entry: DirEntry) => {
      const id = newId();
      const image = isImagePath(entry.path);

      setAttachments(prev => [
        ...prev,
        {
          id,
          name: entry.name,
          bytes: entry.bytes ?? 0,
          kind: image ? 'image' : 'file',
          status: 'loading',
          path: entry.path,
        },
      ]);

      if (image) {
        // 工作目录里的图片同样需要 base64 才能走原生通道
        void (async () => {
          try {
            const content = await onReadAttachment?.(entry.path);
            if (content?.kind !== 'image') throw new Error('读不到这张图片');
            const file = base64ToFile(content.data, entry.name, content.mimeType);
            patch(id, {
              ...(await prepareImageAttachment(file)),
              bytes: content.bytes,
              status: 'ready',
            });
          } catch (error) {
            patch(id, { status: 'error', error: (error as Error).message });
          }
        })();
        return;
      }

      void loadContent(id, entry.path);
      patch(id, { status: 'ready' });
    },
    [onReadAttachment, loadContent, patch]
  );

  /**
   * 拖拽监听挂在**整个窗口**上，而不是只挂在输入框那一条。
   *
   * 之前只给输入区加了 onDrop，而对话区和它是兄弟节点，所以把文件拖到上面
   * 什么都不会发生——用户的第一反应就是往对话区拖。
   *
   * 另外还必须 preventDefault：不然浏览器默认行为是直接打开这个文件，
   * 整个页面会被替掉。
   */
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files');

    const onDragOver = (event: DragEvent) => {
      // 无论拖的是不是文件都要 preventDefault：否则拖动文字 / 链接时的默认行为
      // 会把整个页面导航走（当前对话就没了）
      event.preventDefault();
      if (hasFiles(event)) setDragging(true);
    };

    const onDragLeave = (event: DragEvent) => {
      // dragleave 会在子元素之间反复触发；只有目标不在页面里了才算真的离开窗口
      const next = event.relatedTarget as Node | null;
      if (!next || !document.contains(next)) setDragging(false);
    };

    const onDrop = (event: DragEvent) => {
      // 同上：非文件的拖放也要拦默认行为
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;

      setDragging(false);
      void addFiles(files);
    };

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addFiles]);

  return { attachments, dragging, addFiles, addFromComputer, addFromWorkspace, remove, clear };
}
