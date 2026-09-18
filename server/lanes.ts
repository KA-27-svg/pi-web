import { PiSupervisor, type SpawnPi } from './pi.js';

/**
 * 不带 lane 的客户端归到这里。
 *
 * 这条缺省值是**兼容性的一部分**：同一个 lane 上的多个标签页仍然互相镜像
 * （今天是"开两个标签页看同一个会话"），不支持 lane 的旧页面也不会突然连到别处。
 */
export const DEFAULT_LANE = 'main';

export interface LaneSpec {
  /** 拉起这个 lane 的 pi 时追加的参数（桥接里的静态字面量） */
  extraArgs?: string[];
  /** 是否允许改工作目录。顾问窗口不参与（它没有工具，切目录没有意义） */
  allowCwdChange?: boolean;
}

export interface LaneRegistryCallbacks {
  /** 带 lane 的回调：桥接靠它知道这一行该发给哪些客户端 */
  onLine: (lane: string, line: string) => void;
  onStderr: (lane: string, text: string) => void;
  onExit: (lane: string, code: number | null) => void;
  onError: (lane: string, message: string) => void;
}

export interface LaneRegistryOptions {
  initialCwd: string;
  command: string;
  /** 允许的 lane 白名单；不在里面的 laneId 落到 DEFAULT_LANE */
  allowed?: string[];
  specs?: Record<string, LaneSpec>;
  spawnPi?: SpawnPi;
}

/**
 * 一个 lane = 一个 pi 进程 + 它自己的工作目录。
 *
 * 之所以把「进程句柄 + cwd + 待应用的切会话目录」收在一起：这几样必须同生同死。
 * 以前它们是散在 bridge 里的全局单例，多一个窗口就会出现「A 窗口切会话把 B 窗口的
 * 工作目录也改了」这类串味。
 */
export class Lane {
  readonly id: string;
  readonly spec: LaneSpec;
  /** 这个 lane 的工作目录 */
  cwd: string;
  /**
   * 刚请求切换到的会话的工作目录。
   * pi 的 switch_session 会连带把工作目录换掉，但那个 cwd 只存在会话文件里，
   * RPC 的 get_state 也不返回它，所以桥接自己在转发前读出来，等 pi 确认成功后再应用。
   */
  pendingSwitchCwd: string | null = null;

  private readonly supervisor: PiSupervisor;

  constructor(
    id: string,
    spec: LaneSpec,
    cwd: string,
    command: string,
    callbacks: LaneRegistryCallbacks,
    spawnPi?: SpawnPi
  ) {
    this.id = id;
    this.spec = spec;
    this.cwd = cwd;
    this.supervisor = new PiSupervisor(
      {
        onLine: line => callbacks.onLine(id, line),
        onStderr: text => callbacks.onStderr(id, text),
        onExit: code => callbacks.onExit(id, code),
        onError: message => callbacks.onError(id, message),
      },
      cwd,
      spawnPi,
      command,
      spec.extraArgs ?? []
    );
  }

  get running(): boolean {
    return this.supervisor.running;
  }

  ensure(cwd: string = this.cwd): void {
    this.cwd = cwd;
    this.supervisor.ensure(cwd);
  }

  restart(cwd: string = this.cwd): void {
    this.cwd = cwd;
    this.supervisor.restart(cwd);
  }

  /** 写一条指令。写不进去返回 false，由调用方决定怎么报错 */
  send(command: object): boolean {
    return this.supervisor.send(command);
  }

  setCommand(command: string): void {
    this.supervisor.setCommand(command);
  }

  /** 换附加参数（换模型之类）。下一次 restart 才生效 */
  setExtraArgs(extraArgs: string[]): void {
    this.supervisor.setExtraArgs(extraArgs);
  }
}

/**
 * 所有 lane 的持有者。
 *
 * pi 进程按 lane 惰性创建：没开助手模式的人不该平白多一个 pi 进程，
 * 所以「有指令要发给这个 lane」才是创建时机。
 */
export class LaneRegistry {
  private readonly lanes = new Map<string, Lane>();
  private readonly callbacks: LaneRegistryCallbacks;
  private readonly options: LaneRegistryOptions;
  private command: string;

  constructor(callbacks: LaneRegistryCallbacks, options: LaneRegistryOptions) {
    this.callbacks = callbacks;
    this.options = options;
    this.command = options.command;
  }

  /** 未知 / 缺省的 laneId 一律落到 DEFAULT_LANE */
  normalize(id: unknown): string {
    const value = typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_LANE;
    if (this.options.allowed && !this.options.allowed.includes(value)) return DEFAULT_LANE;
    return value;
  }

  get(id: string): Lane | undefined {
    return this.lanes.get(id);
  }

  /** 取一个 lane，没有就建。**不**拉起进程（那是 ensure 的事） */
  lane(id: string): Lane {
    const existing = this.lanes.get(id);
    if (existing) return existing;

    const lane = new Lane(
      id,
      this.options.specs?.[id] ?? {},
      this.options.initialCwd,
      this.command,
      this.callbacks,
      this.options.spawnPi
    );
    this.lanes.set(id, lane);
    return lane;
  }

  ensure(id: string, cwd: string = this.options.initialCwd): Lane {
    const lane = this.lane(id);
    lane.ensure(cwd);
    return lane;
  }

  send(id: string, command: object): boolean {
    return this.lane(id).send(command);
  }

  restart(id: string, cwd: string = this.options.initialCwd): void {
    this.lane(id).restart(cwd);
  }

  /** 已经存在的 lane 都重启一次（换了 pi 可执行文件 / 装了 pi 之后） */
  restartAll(cwd: string = this.options.initialCwd): void {
    for (const lane of this.lanes.values()) lane.restart(cwd);
  }

  /** 给已经存在的每个 lane 各发一条。**不**创建新 lane（否则会平白拉起进程） */
  sendToAll(command: object): void {
    for (const lane of this.lanes.values()) lane.send(command);
  }

  setCommand(command: string): void {
    this.command = command;
    for (const lane of this.lanes.values()) lane.setCommand(command);
  }

  /** 给状态上报用：这个 lane 是否已经在跑 */
  running(id: string): boolean {
    return this.lanes.get(id)?.running ?? false;
  }

  existingIds(): string[] {
    return [...this.lanes.keys()];
  }
}
