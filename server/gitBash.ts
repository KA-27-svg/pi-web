import type { RunCommand } from './env.js';

/**
 * Windows 上 pi 用哪个 bash 跑命令。
 *
 * 查找顺序照抄 pi 自己（pi 的 docs/windows.md）：
 *   1. settings.json 里的 `shellPath` —— 用户显式指定的最优先
 *   2. Git for Windows 的默认位置
 *   3. PATH 上的 `bash.exe`（Cygwin / MSYS2 / WSL）
 *
 * 为什么要单独成模块，而不是在 env.ts 里跑一句 `bash --version`：
 * 那一句只看得到「启动桥接那个进程的 PATH」。用户装了 Git for Windows 但安装时
 * 没勾「加到 PATH」，pi 能找到、桥接找不到——向导于是报一个假的「缺 Git Bash」，
 * 用户照着提示做也修不好。反过来，PATH 上的 `C:\Windows\system32\bash.exe`
 * （WSL 的壳）在没装发行版时根本跑不起来，只 stat 一下又会把它当成可用。
 *
 * 所以这里对每个候选**真的跑一遍** `--version`，只认能跑起来的那个。
 */

/** Git for Windows 的默认位置。pi 自己也硬编码了这个路径 */
export const GIT_BASH_DEFAULT = 'C:\\Program Files\\Git\\bin\\bash.exe';

export interface GitBashLookup {
  available: boolean;
  /** 实际能跑起来的那个路径；找不到时为 null。界面上用它做诊断 */
  path: string | null;
}

export interface GitBashOptions {
  /** 默认取 process.platform；测试里固定住 */
  platform?: NodeJS.Platform;
  /** settings.json 里的 shellPath。用户显式指定的，所以排在最前面 */
  shellPath?: string | null;
}

export async function findGitBash(
  run: RunCommand,
  options: GitBashOptions = {}
): Promise<GitBashLookup> {
  const platform = options.platform ?? process.platform;

  const candidates = [
    options.shellPath?.trim(),
    // 硬编码的 Git for Windows 位置只在 Windows 上成立
    platform === 'win32' ? GIT_BASH_DEFAULT : null,
    'bash',
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if ((await run(candidate, ['--version'])) !== null) {
      return { available: true, path: candidate };
    }
  }

  return { available: false, path: null };
}
