import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PiSupervisor, type PiSupervisorCallbacks } from './pi';

type FakeChild = ChildProcessWithoutNullStreams & {
  written: string[];
  setStdinWritable(value: boolean): void;
  close(code?: number | null): void;
  fail(message: string): void;
};

function createFakeChild(): FakeChild {
  const emitter = new EventEmitter();
  const state = { killed: false, exitCode: null as number | null, stdinWritable: true };
  const written: string[] = [];

  const child = {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: {
      // 用 getter 而不是可写属性：@types/node 把 killed / exitCode / stdin.writable
      // 都标成了只读，直接赋值在 strict 下通不过
      get writable() {
        return state.stdinWritable;
      },
      write(chunk: string) {
        written.push(chunk);
        return true;
      },
    },
    get killed() {
      return state.killed;
    },
    get exitCode() {
      return state.exitCode;
    },
    kill() {
      state.killed = true;
      return true;
    },
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
    written,
    setStdinWritable(value: boolean) {
      state.stdinWritable = value;
    },
    close(code: number | null = 0) {
      state.exitCode = code;
      emitter.emit('close', code);
    },
    fail(message: string) {
      emitter.emit('error', new Error(message));
    },
  };

  return child as unknown as FakeChild;
}

function createHarness() {
  const spawned: FakeChild[] = [];
  const spawnPi = vi.fn(() => {
    const child = createFakeChild();
    spawned.push(child);
    return child;
  });
  const events = {
    onLine: vi.fn(),
    onStderr: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
  } satisfies PiSupervisorCallbacks;
  const supervisor = new PiSupervisor(events, 'C:/demo', spawnPi);

  return { supervisor, spawnPi, spawned, events };
}

describe('PiSupervisor 生命周期', () => {
  let h: ReturnType<typeof createHarness>;

  beforeEach(() => {
    h = createHarness();
  });

  it('ensure 只拉起一个进程，重复调用不会多起', () => {
    h.supervisor.ensure();
    h.supervisor.ensure();

    expect(h.spawnPi).toHaveBeenCalledTimes(1);
    expect(h.supervisor.running).toBe(true);
  });

  it('进程退出后 running 为假，下一次 ensure 重新拉起', () => {
    h.supervisor.ensure();
    h.spawned[0].close(1);

    expect(h.supervisor.running).toBe(false);
    expect(h.events.onExit).toHaveBeenCalledWith(1);

    h.supervisor.ensure();
    expect(h.spawnPi).toHaveBeenCalledTimes(2);
  });

  it('restart 杀掉旧进程并拉起新的', () => {
    h.supervisor.ensure();
    h.supervisor.restart('C:/other');

    expect(h.spawned[0].killed).toBe(true);
    expect(h.spawnPi).toHaveBeenCalledTimes(2);
    expect(h.supervisor.currentCwd).toBe('C:/other');
  });

  it('被 restart 换掉的旧进程迟到退出时，不会把新进程的引用清掉', () => {
    // 旧进程的 close 回调总是在下一个事件循环才跑，此时新进程已经建好了。
    // 如果 close 里无条件把进程引用置空，下一条指令会再拉起第三个进程：
    // 两个 pi 同时广播事件，界面状态错乱。
    h.supervisor.ensure();
    const old = h.spawned[0];
    h.supervisor.restart('C:/demo');
    const fresh = h.spawned[1];

    old.close(0);

    expect(h.supervisor.running).toBe(true);
    expect(h.events.onExit).not.toHaveBeenCalled();

    h.supervisor.send({ type: 'get_state' });

    expect(h.spawnPi).toHaveBeenCalledTimes(2);
    expect(fresh.written).toHaveLength(1);
    expect(old.written).toHaveLength(0);
  });

  it('被换掉的旧进程迟到报错时同样不干扰新进程', () => {
    h.supervisor.ensure();
    const old = h.spawned[0];
    h.supervisor.restart('C:/demo');

    old.fail('spawn pi ENOENT');

    expect(h.supervisor.running).toBe(true);
    expect(h.events.onError).not.toHaveBeenCalled();
  });

  it('没有进程时 send 会先把它拉起来', () => {
    expect(h.supervisor.send({ type: 'get_state' })).toBe(true);

    expect(h.spawnPi).toHaveBeenCalledTimes(1);
    expect(h.spawned[0].written).toEqual(['{"type":"get_state"}\n']);
  });

  it('stdin 不可写时 send 返回 false，而不是静默丢弃', () => {
    h.supervisor.ensure();
    h.spawned[0].setStdinWritable(false);

    expect(h.supervisor.send({ type: 'prompt', message: 'hi' })).toBe(false);
  });
});

describe('PiSupervisor 输出', () => {
  it('stdout 按行回调，忽略空行', () => {
    const h = createHarness();
    h.supervisor.ensure();

    h.spawned[0].stdout.emit('data', Buffer.from('{"type":"a"}\n\n{"type":"b"}\n'));

    expect(h.events.onLine.mock.calls.map(c => c[0])).toEqual(['{"type":"a"}', '{"type":"b"}']);
  });

  it('跨块的 UTF-8 字符不会被截断成乱码', () => {
    const h = createHarness();
    h.supervisor.ensure();

    const bytes = Buffer.from('{"text":"中文"}\n', 'utf-8');
    // 11 落在「中」中间，14 落在「文」中间，确保两处都是跨界切分
    h.spawned[0].stdout.emit('data', bytes.subarray(0, 11));
    h.spawned[0].stdout.emit('data', bytes.subarray(11, 14));
    h.spawned[0].stdout.emit('data', bytes.subarray(14));

    expect(h.spawned[0].stdout.read()).toBeNull();
    expect(h.events.onLine).toHaveBeenCalledWith('{"text":"中文"}');
  });

  it('stderr 原样回调', () => {
    const h = createHarness();
    h.supervisor.ensure();

    h.spawned[0].stderr.emit('data', Buffer.from('警告\n'));

    expect(h.events.onStderr).toHaveBeenCalledWith('警告\n');
  });

  it('stderr 里被块边界切开的字符也不会变成乱码', () => {
    const h = createHarness();
    h.supervisor.ensure();

    const bytes = Buffer.from('错误：失败', 'utf-8');
    h.spawned[0].stderr.emit('data', bytes.subarray(0, 8));
    h.spawned[0].stderr.emit('data', bytes.subarray(8));

    const merged = h.events.onStderr.mock.calls.map(c => c[0]).join('');
    expect(merged).toBe('错误：失败');
  });
});
