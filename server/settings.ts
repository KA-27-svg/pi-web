import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/** agent 的 shell 工具：pi 在 Windows 上默认是 bash（Git Bash） */
export type ShellTool = 'bash' | 'powershell';

/** pi 的默认内置工具集（不含 shell）。换 shell 时以它为基础，别再动别的。 */
const DEFAULT_BUILTINS = ['read', 'edit', 'write'];

/** 会用 defaultTools 管理的名字；其余（比如将来多出来的内置工具）原样保留在后面 */
const MANAGED = new Set(['read', 'bash', 'powershell', 'edit', 'write']);

export function settingsFilePath(): string {
  return (
    process.env.PI_SETTINGS_FILE || path.join(os.homedir(), '.pi', 'agent', 'settings.json')
  );
}

/**
 * 从 settings.json 的内容判断当前跑的是哪个 shell 工具。
 * 没有 defaultTools 就是 pi 的默认值——Windows 上是 bash。
 */
export function shellToolFromSettings(settings: unknown): ShellTool {
  const tools = (settings as { defaultTools?: unknown } | null)?.defaultTools;
  if (!Array.isArray(tools)) return 'bash';

  // 两个都开着时以 bash 为准：pi 自己的默认就是 bash
  return tools.includes('powershell') && !tools.includes('bash') ? 'powershell' : 'bash';
}

/**
 * 换掉 shell 工具，其余设置原样保留。
 *
 * 只列**内置**工具：`defaultTools` 管不到扩展/自定义工具，把扩展工具写进来反而会
 * 让它们从「扩展提供」变成「内置声明」，语义就乱了。
 */
export function withShellTool(settings: unknown, tool: ShellTool): Record<string, unknown> {
  const base = (settings ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(base.defaultTools)
    ? (base.defaultTools as unknown[]).filter((name): name is string => typeof name === 'string')
    : [];

  const extras = existing.filter(name => !MANAGED.has(name));
  return { ...base, defaultTools: [...DEFAULT_BUILTINS.slice(0, 1), tool, ...DEFAULT_BUILTINS.slice(1), ...extras] };
}

export async function readShellTool(file: string = settingsFilePath()): Promise<ShellTool> {
  const raw = await fs.readFile(file, 'utf-8').catch(() => null);
  if (raw === null || !raw.trim()) return 'bash';

  try {
    return shellToolFromSettings(JSON.parse(raw));
  } catch {
    return 'bash';
  }
}

/**
 * 写回 shell 工具设置。
 *
 * settings.json 是用户自己的文件（终端里的 pi 也读它），所以：
 * 只改 defaultTools 这一个键；文件存在但不是合法 JSON 时宁可直接报错，
 * 也绝不覆盖——那是用户手写坏了的配置，不该由我们来「修」。
 */
export async function writeShellTool(
  tool: ShellTool,
  file: string = settingsFilePath()
): Promise<void> {
  const raw = await fs.readFile(file, 'utf-8').catch(() => null);

  let parsed: unknown = {};
  if (raw !== null && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('pi 的 settings.json 不是合法 JSON，先修好它再改这项设置');
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('pi 的 settings.json 结构不对（不是对象），不敢覆盖');
    }
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(withShellTool(parsed, tool), null, 2)}\n`, 'utf-8');
}
