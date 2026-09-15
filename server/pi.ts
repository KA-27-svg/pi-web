import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { StringDecoder } from 'string_decoder';
import { LineDecoder } from './lines.js';

export interface PiSupervisorCallbacks {
  /** pi 每输出一行完整内容就回调一次（行已 trim，空行不会回调） */
  onLine: (line: string) => void;
  onStderr: (text: string) => void;
  /** 只有「当前」进程退出才回调；被 restart 换掉的旧进程会静默 */
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
}

export type SpawnPi = (cwd: string) => ChildProcessWithoutNullStreams;

export const defaultSpawnPi: SpawnPi = cwd => {
  console.log(`[Pi Bridge] Spawning pi --mode rpc in: ${cwd}`);
  return spawn('pi', ['--mode', 'rpc'], {
    cwd,
    // shell: true 是 Windows 上运行 npm 全局 CLI（pi.cmd）所必需的；
    // 命令行参数是静态字面量，cwd 也只通过 spawn 的 cwd 选项传递，不经过 shell 拼接。
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
  private callbacks: PiSupervisorCallbacks;
  private spawnPi: SpawnPi;

  constructor(
    callbacks: PiSupervisorCallbacks,
    initialCwd: string,
    spawnPi: SpawnPi = defaultSpawnPi
  ) {
    this.callbacks = callbacks;
    this.cwd = initialCwd;
    this.spawnPi = spawnPi;
  }

  get running(): boolean {
    return this.isAlive(this.proc);
  }

  get currentCwd(): string {
    return this.cwd;
  }

  /** 进程不在（崩了 / 没起过）就拉起一个。幂等，可以随便调。 */
  ensure(cwd: string = this.cwd): void {
    if (this.isAlive(this.proc)) return;

    this.cwd = cwd;
    const proc = this.spawnPi(cwd);
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
      this.callbacks.onError(err.message);
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
