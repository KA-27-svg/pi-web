import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { quoteIfNeeded } from './env.js';
import { LineDecoder } from './lines.js';

export interface PiSupervisorCallbacks {
  /** pi 每输出一行完整内容就回调一次（行已 trim，空行不会回调） */
  onLine: (line: string) => void;
  onStderr: (text: string) => void;
  /** 只有「当前」进程退出才回调；被 restart 换掉的旧进程会静默 */
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
}

export type SpawnPi = (cwd: string, command: string) => ChildProcessWithoutNullStreams;

/**
 * 把 spawn 的底层错误翻译成能看懂的话。
 * ENOENT 实际只意味着「这个路径下没有可执行文件」，也就是 pi 没装或路径不对，
 * 直接把 `spawn pi ENOENT` 丢给用户等于什么也没说。
 */
export function describeSpawnError(error: Error, command: string): string {
  if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
    return `找不到 pi（尝试执行：${command}）。本机可能还没安装 pi，请先完成首次运行向导。`;
  }
  return error.message;
}

export const defaultSpawnPi: SpawnPi = (cwd, command) => {
  // 必须加引号：command 可能是 resolvePiCommand 解析出的绝对路径，而 shell: true
  // 是把它拼进命令行交给 cmd 的，路径带空格（用户目录叫 `John Doe` 这类）会被
  // 从空格处断开，表现成「pi 明明在、就是起不来」。
  const file = quoteIfNeeded(command);
  console.log(`[Pi Bridge] Spawning ${file} --mode rpc in: ${cwd}`);
  return spawn(file, ['--mode', 'rpc'], {
    cwd,
    // shell: true 是 Windows 上运行 npm 全局 CLI（pi.cmd）所必需的；
    // 参数是静态字面量，cwd 也只通过 spawn 的 cwd 选项传递，不经过 shell 拼接。
    shell: true,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
};

/**
 * `pi --mode rpc` 子进程的生命周期。
 *
 * 之所以单独成一个模块而不是塞在 bridge 里：进程句柄的归属判断是这里最容易出错的地方，
 * 隔离出来才能注入假进程做确定性测试（见 pi.test.ts）。
 */
export class PiSupervisor {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private cwd: string;
  /**
   * pi 可执行文件。
   * 默认就是 `pi`（交给 PATH）；解析出绝对路径后用 setCommand 换掉。
   */
  private command: string;
  private callbacks: PiSupervisorCallbacks;
  private spawnPi: SpawnPi;

  constructor(
    callbacks: PiSupervisorCallbacks,
    initialCwd: string,
    spawnPi: SpawnPi = defaultSpawnPi,
    command = 'pi'
  ) {
    this.callbacks = callbacks;
    this.cwd = initialCwd;
    this.spawnPi = spawnPi;
    this.command = command;
  }

  get running(): boolean {
    return this.isAlive(this.proc);
  }

  get currentCwd(): string {
    return this.cwd;
  }

  get currentCommand(): string {
    return this.command;
  }

  /**
   * 改用解析出的 pi 路径。
   *
   * 安装完成后必须调它：官方安装器只把新目录写进用户 PATH，已经跑着的桥接
   * 进程读不到，继续用 `pi` 会一直找不到刚装好的那个。
   * 下一次 ensure / restart 就会用新路径拉起。
   */
  setCommand(command: string): void {
    this.command = command;
  }

  /** 进程不在（崩了 / 没起过）就拉起一个。幂等，可以随便调。 */
  ensure(cwd: string = this.cwd): void {
    if (this.isAlive(this.proc)) return;

    this.cwd = cwd;
    const proc = this.spawnPi(cwd, this.command);
    this.proc = proc;
    const decoder = new LineDecoder();
    // stderr 不是按行协议的，但也得避免把多字节字符从中间劈开
    const stderrDecoder = new StringDecoder('utf-8');

    proc.stdout.on('data', (chunk: Buffer) => {
      for (const line of decoder.push(chunk)) {
        const trimmed = line.trim();
        if (trimmed) this.callbacks.onLine(trimmed);
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      this.callbacks.onStderr(stderrDecoder.write(chunk));
    });

    proc.on('close', code => {
      // 被 restart 换掉的旧进程不代表桥接现在没进程，静默丢弃它的退出：
      // 否则「新进程刚建好就被置空」会让下一条指令又拉起一个，
      // 两个 pi 同时往浏览器广播同一套事件。
      if (this.proc !== proc) return;
      this.proc = null;
      this.callbacks.onExit(code);
    });

    proc.on('error', err => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.callbacks.onError(describeSpawnError(err, this.command));
    });
  }

  /** 换一个工作目录重启：先断开引用再杀，旧进程的回调因此不会影响新进程 */
  restart(cwd: string = this.cwd): void {
    const old = this.proc;
    this.proc = null;
    if (old) {
      try {
        old.kill();
      } catch {
        // 进程可能已经退出，忽略
      }
    }
    this.ensure(cwd);
  }

  /** 写一条指令。进程不可用或写不进去时返回 false，由调用方决定怎么报错。 */
  send(command: object): boolean {
    this.ensure();
    const proc = this.proc;
    if (!proc || !proc.stdin.writable) return false;

    proc.stdin.write(`${JSON.stringify(command)}\n`, 'utf-8');
    return true;
  }

  private isAlive(
    proc: ChildProcessWithoutNullStreams | null
  ): proc is ChildProcessWithoutNullStreams {
    return !!proc && proc.exitCode === null && !proc.killed;
  }
}
