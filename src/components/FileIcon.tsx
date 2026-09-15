import { File, FileArchive, FileAudio, FileCode, FileJson, FileSpreadsheet, FileText, FileVideo, Presentation } from 'lucide-react';
import type { ComponentType } from 'react';
import { fileKind, type FileKind } from '../utils/attachments';

/**
 * 每种文件类型一个图标 + 一种颜色。
 *
 * 颜色只是「一眼能分辨」的辅助手段，不承担语义——所以用的是 Tailwind 调色板里
 * 在深浅两种主题下都读得清的 500 档，不做 dark: 变体。
 */
const VISUALS: Record<FileKind, { Icon: ComponentType<{ className?: string }>; tone: string }> = {
  code: { Icon: FileCode, tone: 'text-sky-500' },
  json: { Icon: FileJson, tone: 'text-amber-500' },
  doc: { Icon: FileText, tone: 'text-blue-500' },
  sheet: { Icon: FileSpreadsheet, tone: 'text-emerald-500' },
  slide: { Icon: Presentation, tone: 'text-orange-500' },
  archive: { Icon: FileArchive, tone: 'text-yellow-600' },
  audio: { Icon: FileAudio, tone: 'text-pink-500' },
  video: { Icon: FileVideo, tone: 'text-violet-500' },
  image: { Icon: FileText, tone: 'text-teal-500' },
  other: { Icon: File, tone: 'text-muted' },
};

interface FileIconProps {
  /** 文件名（或路径），只用扩展名 */
  name: string;
  className?: string;
}

/** 按文件类型选图标与颜色。对话里的文件卡片和输入框的附件条共用它。 */
export function FileIcon({ name, className = 'w-3.5 h-3.5 shrink-0' }: FileIconProps) {
  const { Icon, tone } = VISUALS[fileKind(name)];
  return <Icon className={`${className} ${tone}`} />;
}
