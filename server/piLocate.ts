import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { RunCommand } from './env.js';

/**
 * 解析 pi 可执行文件的绝对路径。
 *
 * 存在的理由：pi 装好之后，**当前进程的 PATH 不会更新**。官方安装器会把
 * 安装目录写进用户 PATH 并通知系统，但已经跑着的桥接进程拿不到，于是
 * `spawn('pi')` 依然找不到它，表现成「明明装成功了却还是说没装」。
 *
 * 所以桥接自己按平台去已知位置找一遍。找不到就返回 null，由调用方退回
 * 依赖 PATH 的 `pi`——这样已装 pi 的机器行为完全不变。
 *
 * 只判断文件是否存在，不实际执行：探测要快，而且真跑不起来时 PiSupervisor
 * 的 error 分支会接住。
 */

/** 判断候选路径是否是一个文件。注入是为了测试不碰真实文件系统 */
export type FileExists = (target: string) => boolean;

export const defaultFileExists: FileExists = target => {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
};

export interface LocateOptions {
  /** 默认取 process.platform；测试里固定住 */
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homedir?: string;
  exists?: FileExists;
}

/** 问 npm 全局前缀在哪。失败返回 null，不影响其它候选 */
async function npmGlobalPrefix(run: RunCommand): Promise<string | null> {
  const raw = await run('npm', ['prefix', '-g']);
  const value = raw?.trim();
  return value ? value : null;
}

export async function resolvePiCommand(
  run: RunCommand,
  options: LocateOptions = {}
): Promise<string | null> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.homedir ?? os.homedir();
  const exists = options.exists ?? defaultFileExists;

  const isWindows = platform === 'win32';
  // 按目标平台拼路径，而不是宿主的 path：否则在 Windows 上跑测试时会算出反斜杠，
  // 到了 Linux CI 又变成正斜杠，测试结果随宿主漂移。
  const join = isWindows ? path.win32.join : path.posix.join;
  const binary = isWindows ? 'pi.cmd' : 'pi';

  const candidates: string[] = [];
  const prefixBinary = (prefix: string) =>
    isWindows ? join(prefix, binary) : join(prefix, 'bin', binary);

  // 1. 官方安装器在 npm 全局目录不可写时会显式指定前缀
  const explicitPrefix = env.PI_NPM_INSTALL_PREFIX?.trim();
  if (explicitPrefix) candidates.push(prefixBinary(explicitPrefix));

  // 2. npm 自己的全局前缀，也就是官方安装器的默认去处
  const npmPrefix = await npmGlobalPrefix(run);
  if (npmPrefix) candidates.push(prefixBinary(npmPrefix));

  if (isWindows) {
    // npm 在 Windows 上把 shim 直接放在 %APPDATA%\npm，而不是 prefix\bin
    const appData = env.APPDATA?.trim();
    if (appData) candidates.push(join(appData, 'npm', binary));

    // 官方安装器自带的 standalone Node（没装 Node 时它会装到这里）
    const localAppData = env.LOCALAPPDATA?.trim();
    if (localAppData) candidates.push(join(localAppData, 'pi-node', 'current', binary));

    // 实验性的 managed install（PI_EXPERIMENTAL=1 时官方安装器用这个布局）
    candidates.push(join(home, '.pi', 'agent', 'install', binary));
  } else {
    // 官方安装器在全局前缀不可写时退到 ~/.local
    candidates.push(join(home, '.local', 'bin', binary));
  }

  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export interface PiLocator {
  /**
   * 探测 pi 时该用的命令：解析成功就是绝对路径，否则退回 PATH 里的 `pi`。
   * 已装 pi 且 PATH 正常的机器因此行为完全不变。
   */
  readonly command: string;
  /** 解析一次并记住；已解析成功过就直接返回 */
  locate(): Promise<string | null>;
  /** 作废缓存后重新解析。安装完成后必须这样调一次 */
  refresh(): Promise<string | null>;
}

/**
 * 解析结果的缓存。
 *
 * 之所以不直接用 resolvePiCommand：它每次都要起一个 `npm prefix -g` 子进程，
 * 而向导每 5 秒轮询一次 get_setup_status，不能每次都重跑。
 *
 * 两条规则决定了这里只能这样写：
 *  - **失败不缓存**。「用户刚在自己的终端里装好了 pi」这种情况，桥接无从得知，
 *    只能靠下次重试发现；把 null 记下来就永远发现不了了。
 *  - **成功才缓存**。装好的 pi 不会自己搬家，反复去问只是白花钱。
 */
export function createPiLocator(run: RunCommand, options: LocateOptions = {}): PiLocator {
  let cached: string | null = null;

  const locate = async (): Promise<string | null> => {
    if (cached) return cached;
    cached = await resolvePiCommand(run, options);
    return cached;
  };

  return {
    get command(): string {
      return cached ?? 'pi';
    },
    locate,
    refresh(): Promise<string | null> {
      cached = null;
      return locate();
    },
  };
}
