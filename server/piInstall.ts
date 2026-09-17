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
 * Node 不够版本时不能：官方安装器在无终端下会直接报错退出，代跑只会得到一条看不懂的失败。
 *
 * 「Node 不够」这件事本身在 Windows 上已经由 tools/launch.ps1 的 Ensure-Node 解决了
 * （启动时就自动装一份到 runtime\node），所以这里给的是一条真能照做的路子，
 * 不是笼统的「请自己去装」。
 */
export function installPreflight(status: SetupStatus): InstallPreflight {
  if (!status.node.ok) {
    return {
      allowed: false,
      reason:
        status.platform === 'win32'
          ? `Node.js 版本不够（pi 需要 ${MINIMUM_NODE_TEXT} 或更新）。关掉再重新打开 Pi Web，启动时会自动装一份达标的 Node 到项目目录，不需要你手动做任何事。`
          : `Node.js 版本不够（pi 需要 ${MINIMUM_NODE_TEXT} 或更新）。官方安装器在没有终端时不会自己装 Node，请按下面的命令在你自己的终端里跑一次。`,
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

export interface InstallOutcome {
  /** 用户该看到的结论：以「pi 到底能不能跑」为准，不是安装器的退出码 */
  ok: boolean;
  /** 真正的失败原因，ok 为假时才有 */
  error?: string;
  /** 安装器报了失败、但 pi 其实已可用时留一条线索，不静默吞掉 */
  notice?: string;
}

/**
 * 判断这次安装到底算不算成功。
 *
 * 不能只看安装器的退出码。官方安装器在 `npm install -g pi` 成功之后还有收尾步骤
 * （配置 PowerShell shim 的执行策略、刷新 PATH 等），任何一步失败都会让整份脚本以
 * 非零码退出——而 pi 其实已经装好了。实测复现过：装完 `pi.cmd` 就躺在磁盘上、能跑，
 * 退出码却是 1。只看退出码，用户在页面上会同时看到红色的【安装失败】和已经就绪的
 * 状态，完全不知道该信哪个。
 *
 * 所以以「pi 能不能跑」为准：探测说装好了就算成功，退出码降级成一条提示。
 */
export function classifyInstallOutcome(
  result: InstallResult,
  piReady: boolean
): InstallOutcome {
  if (result.ok) return { ok: true };

  if (piReady) {
    return {
      ok: true,
      notice: `安装器以退出码 ${result.code ?? '未知'} 结束，但 pi 已经装好并可用（多半是收尾步骤失败，不影响使用）。`,
    };
  }

  return {
    ok: false,
    error: result.error ?? `安装器以退出码 ${result.code ?? '未知'} 结束`,
  };
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
