import { EventEmitter } from 'events';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LANE, LaneRegistry, type LaneRegistryCallbacks } from './lanes';
import type { SpawnPi } from './pi';

const ADVISOR = 'advisor';

type FakeChild = ChildProcessWithoutNullStreams & {
  written: string[];
  stdout: EventEmitter;
  close(code?: number | null): void;
};

/** 只实现 PiSupervisor 真正用到的那几样：stdin.write / stdout.on / close / kill */
function createFakeChild(): FakeChild {
  const emitter = new EventEmitter();
  const stdinEmitter = new EventEmitter();
  const stdout = new EventEmitter();
  let exitCode: number | null = null;
  let killed = false;
  const written: string[] = [];

  const child = {
    stdout,
    stderr: new EventEmitter(),
    stdin: {
      get writable() {
        return true;
      },
      write(chunk: string) {
        written.push(chunk);
        return true;
      },
      on: stdinEmitter.on.bind(stdinEmitter),
      once: stdinEmitter.once.bind(stdinEmitter),
      off: stdinEmitter.off.bind(stdinEmitter),
    },
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    kill() {
      killed = true;
      return true;
    },
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    written,
    close(code: number | null = 0) {
      exitCode = code;
      emitter.emit('close', code);
    },
  };

  return child as unknown as FakeChild;
}

function createHarness() {
  const spawned: FakeChild[] = [];
  const spawnCalls: Array<{ cwd: string; command: string; extraArgs: string[] }> = [];
  const spawnPi: SpawnPi = (cwd, command, extraArgs) => {
    spawnCalls.push({ cwd, command, extraArgs });
    const child = createFakeChild();
    spawned.push(child);
    return child;
  };

  const callbacks = {
    onLine: vi.fn(),
    onStderr: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
  } satisfies LaneRegistryCallbacks;

  const lanes = new LaneRegistry(callbacks, {
    initialCwd: 'C:/demo',
    command: 'pi',
    allowed: [DEFAULT_LANE, ADVISOR],
    specs: { [ADVISOR]: { extraArgs: ['--no-tools', '--session-dir', 'C:/adv'], allowCwdChange: false } },
    spawnPi,
  });

  return { lanes, callbacks, spawned, spawnCalls };
}

describe('lane 白名单与缺省值', () => {
  it('缺省 / 空 / 未知的 laneId 都落到 main（旧页面必须还能镜像同一会话）', () => {
    const { lanes } = createHarness();

    expect(lanes.normalize(undefined)).toBe(DEFAULT_LANE);
    expect(lanes.normalize('')).toBe(DEFAULT_LANE);
    expect(lanes.normalize('   ')).toBe(DEFAULT_LANE);
    expect(lanes.normalize('nope')).toBe(DEFAULT_LANE);
    expect(lanes.normalize(42)).toBe(DEFAULT_LANE);
  });

  it('白名单里的 lane 原样通过', () => {
    const { lanes } = createHarness();

    expect(lanes.normalize(DEFAULT_LANE)).toBe(DEFAULT_LANE);
    expect(lanes.normalize(ADVISOR)).toBe(ADVISOR);
  });
});

describe('惰性拉起', () => {
  it('取 lane 不会拉起进程', () => {
    const { lanes, spawnCalls } = createHarness();

    lanes.lane(ADVISOR);

    expect(spawnCalls).toHaveLength(0);
  });

  it('ensure 才拉起，重复调用不会多起', () => {
    const { lanes, spawnCalls } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.ensure(DEFAULT_LANE);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cwd).toBe('C:/demo');
  });

  it('顾问 lane 带上自己的附加参数', () => {
    const { lanes, spawnCalls } = createHarness();

    lanes.ensure(ADVISOR);

    expect(spawnCalls[0].extraArgs).toEqual(['--no-tools', '--session-dir', 'C:/adv']);
  });
});

describe('lane 之间互不影响', () => {
  it('各自的指令写进各自的进程', () => {
    const { lanes, spawned } = createHarness();

    lanes.send(DEFAULT_LANE, { type: 'prompt', message: '做' });
    lanes.send(ADVISOR, { type: 'prompt', message: '想' });

    expect(spawned).toHaveLength(2);
    expect(JSON.parse(spawned[0].written[0])).toEqual({ type: 'prompt', message: '做' });
    expect(JSON.parse(spawned[1].written[0])).toEqual({ type: 'prompt', message: '想' });
  });

  it('同 lane 复用同一个进程', () => {
    const { lanes, spawnCalls } = createHarness();

    lanes.send(DEFAULT_LANE, { type: 'get_state' });
    lanes.send(DEFAULT_LANE, { type: 'get_messages' });

    expect(spawnCalls).toHaveLength(1);
  });

  it('输出回调带上 lane（桥接靠它决定发给哪些客户端）', () => {
    const { lanes, callbacks, spawned } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.ensure(ADVISOR);
    spawned[1].stdout.emit('data', Buffer.from('{"type":"tick"}\n'));

    expect(callbacks.onLine).toHaveBeenCalledWith(ADVISOR, '{"type":"tick"}');
    expect(callbacks.onLine).not.toHaveBeenCalledWith(DEFAULT_LANE, '{"type":"tick"}');
  });

  it('进程退出只报自己那个 lane', () => {
    const { lanes, callbacks, spawned } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.ensure(ADVISOR);
    spawned[0].close(1);

    expect(callbacks.onExit).toHaveBeenCalledWith(DEFAULT_LANE, 1);
    expect(callbacks.onExit).toHaveBeenCalledTimes(1);
    expect(lanes.running(DEFAULT_LANE)).toBe(false);
    expect(lanes.running(ADVISOR)).toBe(true);
  });

  it('restart 只换自己那个 lane 的进程', () => {
    const { lanes, spawned, spawnCalls } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.ensure(ADVISOR);
    lanes.restart(DEFAULT_LANE, 'C:/other');

    expect(spawnCalls).toHaveLength(3);
    expect(spawnCalls[2].cwd).toBe('C:/other');
    expect(spawned[0].killed).toBe(true);
    expect(spawned[1].killed).toBe(false);
    expect(lanes.lane(DEFAULT_LANE).cwd).toBe('C:/other');
    expect(lanes.lane(ADVISOR).cwd).toBe('C:/demo');
  });
});

describe('批量指令', () => {
  it('sendToAll 只发给已经存在的 lane，不因此多拉起一个', () => {
    const { lanes, spawnCalls } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.sendToAll({ type: 'get_available_models' });

    expect(spawnCalls).toHaveLength(1);
    expect(lanes.existingIds()).toEqual([DEFAULT_LANE]);
  });

  it('两个 lane 都在时都会收到', () => {
    const { lanes, spawned } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.ensure(ADVISOR);
    lanes.sendToAll({ type: 'get_state' });

    expect(spawned[0].written).toHaveLength(1);
    expect(spawned[1].written).toHaveLength(1);
  });
});

describe('pi 可执行文件路径', () => {
  it('setCommand 对已存在的 lane 生效，之后新建的也用新路径', () => {
    const { lanes, spawnCalls } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.setCommand('C:/Users/me/AppData/Roaming/npm/pi.cmd');
    lanes.ensure(ADVISOR);

    expect(spawnCalls[0].command).toBe('pi');
    expect(spawnCalls[1].command).toBe('C:/Users/me/AppData/Roaming/npm/pi.cmd');
  });

  it('restartAll 之后每个 lane 都用新路径', () => {
    const { lanes, spawnCalls } = createHarness();

    lanes.ensure(DEFAULT_LANE);
    lanes.ensure(ADVISOR);
    lanes.setCommand('pi2');
    lanes.restartAll();

    expect(spawnCalls.slice(2).every(call => call.command === 'pi2')).toBe(true);
  });
});
