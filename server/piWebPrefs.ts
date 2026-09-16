import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * pi-web 自己的偏好。
 *
 * **故意不写进 pi 的全局 settings.json**：那是终端里 pi 也在读的文件，从网页改它
 * 会静默改掉你在终端的行为（这条教训来自被撤掉的 shell 开关）。
 */
export interface WebPrefs {
  /** 只读模式：把能改文件、能跑命令的工具全部排除掉 */
  readOnly: boolean;
}

export const DEFAULT_PREFS: WebPrefs = { readOnly: false };

export function prefsFilePath(): string {
  return (
    process.env.PI_WEB_PREFS || path.join(os.homedir(), '.pi', 'agent', 'pi-web-prefs.json')
  );
}

/** 只认识 readOnly 字段，别的类型一律回退到默认值 */
export function parsePrefs(raw: unknown): WebPrefs {
  const value = (raw as { readOnly?: unknown } | null)?.readOnly;
  return { readOnly: value === true };
}

export async function readPrefs(file: string = prefsFilePath()): Promise<WebPrefs> {
  const text = await fs.readFile(file, 'utf-8').catch(() => null);
  if (!text || !text.trim()) return DEFAULT_PREFS;

  try {
    return parsePrefs(JSON.parse(text));
  } catch {
    // 我们自己的小文件，坏了就用默认值，不必让桥接启动失败
    return DEFAULT_PREFS;
  }
}

export async function writePrefs(
  prefs: WebPrefs,
  file: string = prefsFilePath()
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(prefs, null, 2)}\n`, 'utf-8');
}
