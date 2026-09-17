/**
 * 找不到 Git Bash 时，让 pi 改用 PowerShell 跑命令。
 *
 * 为什么不是下载 PortableGit：pi 官方就给了一条不用装任何东西的路——把
 * `defaultTools` 里的 `bash` 换成 `powershell`（pi 的 docs/windows.md 与
 * docs/settings.md 都是这么建议的）。写一行配置，对比下一个 PortableGit
 * 解压包再执行它，代价差得太远。
 *
 * pi 内置的默认工具集是 ["read", "bash", "edit", "write"]（pi 的 bundle 里写着），
 * 所以这里就是在它基础上把 bash 换成 powershell。
 */

/** pi 内置的默认工具集。自愈时写回它 */
export const DEFAULT_TOOLS = ['read', 'bash', 'edit', 'write'];

/** 没有 bash 时顶上去的那一套 */
export const POWERSHELL_TOOLS = ['read', 'powershell', 'edit', 'write'];

export type ShellMode = 'bash' | 'powershell';

/** 两个工具集是不是完全一样（顺序也算，用户改过顺序就当我们不认识它） */
export function isSameTools(a: string[] | null | undefined, b: string[]): boolean {
  return Array.isArray(a) && a.length === b.length && a.every((item, index) => item === b[index]);
}

/**
 * 生效之后 pi 会用哪个工具跑命令。
 *
 * 只看工具集本身，不看 bash 在不在——用户完全可以自己把两个都开着，
 * 那种情况下 bash 仍然是主路。
 */
export function effectiveShellMode(tools: string[] | null | undefined): ShellMode {
  if (Array.isArray(tools) && tools.includes('powershell') && !tools.includes('bash')) {
    return 'powershell';
  }
  return 'bash';
}

export interface ToolPlan {
  /** 要写进 settings.json 的 `defaultTools`；不用动时为 undefined */
  write?: string[];
  /** 生效之后 pi 用哪个工具跑命令 */
  mode: ShellMode;
  /** 为什么这么决定。写进桥接日志，出问题时这是唯一线索 */
  reason: string;
}

/**
 * 该不该动 settings.json 的 `defaultTools`。
 *
 * 四条规则，核心是「只动我们自己写的那一份，不碰用户自己配的」：
 *
 * | 找到 bash | 当前的 defaultTools        | 动作            |
 * |-----------|----------------------------|-----------------|
 * | 是        | 正好是我们上次写的          | 写回默认（自愈） |
 * | 是        | 其它                        | 不动            |
 * | 否        | 没设过 / 就是 pi 的默认      | 换成 PowerShell |
 * | 否        | 正好是我们上次写的          | 不动（幂等）     |
 * | 否        | 用户自己配的别的值          | 不动            |
 *
 * 「正好等于我们写的那一份」就说明是我们写的，不是用户挑的——所以既能幂等，
 * 也能在用户后来装了 Git Bash 时自动换回来。不需要额外记状态位。
 */
export function planToolFallback(input: {
  bashAvailable: boolean;
  defaultTools: string[] | null | undefined;
}): ToolPlan {
  const tools = Array.isArray(input.defaultTools) ? input.defaultTools : DEFAULT_TOOLS;
  const isOurs = isSameTools(tools, POWERSHELL_TOOLS);
  const isPiDefault = !Array.isArray(input.defaultTools) || isSameTools(tools, DEFAULT_TOOLS);

  let write: string[] | undefined;
  let reason: string;

  if (input.bashAvailable) {
    if (isOurs) {
      write = DEFAULT_TOOLS;
      reason = '找到 Git Bash，把上次顶上的 PowerShell 工具换回 bash';
    } else {
      reason = '找到 Git Bash，用 pi 默认的 bash 工具';
    }
  } else if (isOurs) {
    reason = '没有 Git Bash，已经换成 PowerShell 了';
  } else if (isPiDefault) {
    write = POWERSHELL_TOOLS;
    reason = `没有 Git Bash，把 bash 工具换成 PowerShell（不用装任何东西；想用 bash 就装一个 Git for Windows）`;
  } else {
    reason = '没有 Git Bash，但用户自己配过 defaultTools，不动它';
  }

  return { write, mode: effectiveShellMode(write ?? tools), reason };
}
