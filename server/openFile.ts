import { spawn } from 'child_process';

/** 打开动作最多等这么久；Start-Process 自己不等程序退出，所以很快 */
export const OPEN_TIMEOUT_MS = 10_000;

export interface OpenCommand {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
}

export type SpawnOpen = (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<void>;

/**
 * 用系统默认程序打开一个文件。
 *
 * Windows 上**故意不用** `cmd /c start`：文件名里可以合法地出现 `&` `^` `|` `(`
 * 这类字符，而 cmd 会把它们当命令分隔符——`付款&calc.txt` 会真的去启动 calc。
 * 改成把路径通过**环境变量**交给一段静态 PowerShell 脚本，路径不参与任何解析。
 *
 * 试过 `explorer.exe <文件>`——实测它只打开所在文件夹，不会用默认程序打开文件。
 *
 * 注意是 `-FilePath` 而不是 `-LiteralPath`：后者是 PowerShell 7 才有的参数，
 * Windows PowerShell 5.1 会直接报“找不到与参数名称 LiteralPath 匹配的参数”而静默失败
 * （实测过）。`-FilePath` 拿的是普通字符串，值又来自环境变量，同样没有注入面。
 */
export function openCommand(platform: NodeJS.Platform, target: string): OpenCommand {
  if (platform === 'win32') {
    return {
      command: 'powershell',
      args: ['-NoProfile', '-Command', 'Start-Process -FilePath $env:PI_OPEN_TARGET'],
      // 覆盖 process.env 里的同名键，避免用户已经设过这个变量时串味
      env: { ...process.env, PI_OPEN_TARGET: target },
    };
  }

  if (platform === 'darwin') return { command: 'open', args: [target] };

  return { command: 'xdg-open', args: [target] };
}

const defaultSpawn: SpawnOpen = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve();
    }, OPEN_TIMEOUT_MS);

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
  });

/** 打开一个文件（或文件夹）。调用方负责先校验路径允许不允许。 */
export async function openWithSystem(
  target: string,
  deps: { spawn?: SpawnOpen; platform?: NodeJS.Platform } = {}
): Promise<void> {
  const platform = deps.platform ?? process.platform;
  const run = deps.spawn ?? defaultSpawn;

  const { command, args, env } = openCommand(platform, target);
  await run(command, args, env);
}
