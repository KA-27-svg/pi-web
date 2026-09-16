import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { AnsiLineDecoder } from './ansiLines.js';
import { MINIMUM_NODE_TEXT, type SetupStatus } from './env.js';
import { describeSpawnError } from './pi.js';

/**
 * 代跑 pi 的官方安装器。
 *
 * 两条硬约束来自官方脚本本身：
 *  - 它们要求机器上已经有 Node >= 22.19 与 npm，**没有终端时不会自己去装 Node**。
 *    所以 Node 不够版本时只能引导用户自己跑（见 installPreflight）。
 *  - `install.sh` 用 `: <>/dev/tty` 判断有没有终端，开的是**控制终端**而不是 stdin。
 *    桥接是从终端启动的，子进程即使 stdin 是管道也仍共享那个控制终端，
 *    于是脚本会问 `[Y/n]` 然后永久等输入。所以要让它脱离控制终端。
 */

const INSTALL_SH_URL = 'https://pi.dev/install.sh';
const INSTALL_PS1_URL = 'https://pi.dev/install.ps1';

export interface InstallCommand {
  /** 展示给用户的确切命令：复制到终端也能直接跑 */
  display: string;
  file: string;
  args: string[];
  /**
   * 是否让子进程进入新 session（脱离控制终端）。
   * 见文件头部注释：不脱离的话 install.sh 会卡在交互提示上。
   */
  detached: boolean;
}

export function buildInstallCommand(
  platform: NodeJS.Platform = process.platform
): InstallCommand {
  if (platform === 'win32') {
    return {
      display: `powershell -c "irm ${INSTALL_PS1_URL} | iex"`,
      file: 'powershell',
      args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `irm ${INSTALL_PS1_URL} | iex`],
      // install.ps1 判的是 [Console]::IsInputRedirected，管道 stdin 即为真，不需要脱离
      detached: false,
    };
  }

  return {
    display: `curl -fsSL ${INSTALL_SH_URL} | sh`,
    file: 'sh',
    args: ['-c', `curl -fsSL ${INSTALL_SH_URL} | sh`],
    detached: true,
  };
}

export interface InstallPreflight {
  /** 能否由桥接代跑 */
  allowed: boolean;
  /** 不允许时的原因，直接展示给用户 */
  reason?: string;
}

/**
 * 判断能不能代跑。
 * Node 不够版本时不能：官方脚本在无终端下会直接报错退出，代跑只会得到一条看不懂的失败。
 */
export function installPreflight(status: SetupStatus): InstallPreflight {
  if (!status.node.ok) {
    return {
      allowed: false,
      reason: `Node.js 版本不够（pi 需要 ${MINIMUM_NODE_TEXT} 或更新）。官方安装器在没有终端时不会自己装 Node，请按下面的命令在你自己的终端里跑一次。`,
    };
  }

  if (!status.npm.available) {
    return { allowed: false, reason: '没找到 npm，官方安装器需要它来安装 pi。' };
  }

  return { allowed: true };
}

export type SpawnInstaller = (command: InstallCommand) => ChildProcessWithoutNullStreams;

export const defaultSpawnInstaller: SpawnInstaller = command =>
  spawn(command.file, command.args, {
    // 命令与参数都是静态字面量，不经过 shell
    shell: false,
    detached: command.detached,
    windowsHide: true,
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
  });

export interface InstallRunOptions {
  platform?: NodeJS.Platform;
  /** 每一行已可显示的日志 */
  onLine: (line: string) => void;
  signal?: AbortSignal;
}

export interface InstallResult {
  ok: boolean;
  code: number | null;
  error?: string;
}

/**
 * 结束安装进程。
 *
 * detached 的子进程是新 session 的组长，只杀它自己会留下 curl / npm 这些后代，
 * 所以连同整个进程组一起杀（PID 取负）。Windows 没有进程组这个概念，直接 kill。
 */
function killProcessTree(child: ChildProcessWithoutNullStreams, detached: boolean): void {
  if (detached && process.platform !== 'win32' && child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
      return;
    } catch {
      // 进程组可能已经不在了，落到下面直接 kill
    }
  }

  try {
    child.kill();
  } catch {
    // 已经退出
  }
}

export function runInstall(
  options: InstallRunOptions,
  spawnInstaller: SpawnInstaller = defaultSpawnInstaller
): Promise<InstallResult> {
  const command = buildInstallCommand(options.platform);
  const child = spawnInstaller(command);
  // stdout 与 stderr 各一个解码器：共用一个的话，两个流的多字节字符会互相插队
  const stdout = new AnsiLineDecoder();
  const stderr = new AnsiLineDecoder();

  return new Promise<InstallResult>(resolve => {
    let settled = false;

    const finish = (result: InstallResult) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', onAbort);
      resolve(result);
    };

    const onAbort = () => {
      killProcessTree(child, command.detached);
      finish({ ok: false, code: null, error: '安装已取消' });
    };

    child.stdout.on('data', (chunk: Buffer) => {
      for (const line of stdout.push(chunk)) options.onLine(line);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      for (const line of stderr.push(chunk)) options.onLine(line);
    });

    child.on('error', err => {
      finish({ ok: false, code: null, error: describeSpawnError(err, command.file) });
    });

    child.on('close', code => {
      for (const line of [...stdout.flush(), ...stderr.flush()]) options.onLine(line);
      finish(
        code === 0
          ? { ok: true, code: 0 }
          : { ok: false, code, error: `安装器以退出码 ${code ?? '未知'} 结束` }
      );
    });

    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort);
    }
  });
}
