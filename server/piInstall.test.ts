import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from './env';
import {
  buildInstallCommand,
  installPreflight,
  runInstall,
  type SpawnInstaller,
} from './piInstall';

type FakeChild = ChildProcessWithoutNullStreams & { killed: boolean };

function createFakeChild(): FakeChild {
  const emitter = new EventEmitter();
  const child = {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    pid: 1_073_741_824,
    killed: false,
    kill() {
      this.killed = true;
      return true;
    },
    on: emitter.on.bind(emitter),
    once: emitter.once.bind(emitter),
    off: emitter.off.bind(emitter),
    emit: emitter.emit.bind(emitter),
  };
  return child as unknown as FakeChild;
}

function harness() {
  const children: FakeChild[] = [];
  const spawnInstaller = vi.fn<SpawnInstaller>(() => {
    const child = createFakeChild();
    children.push(child);
    return child;
  });
  return { children, spawnInstaller };
}

describe('buildInstallCommand', () => {
  it('Windows 走官方 PowerShell 安装器', () => {
    const command = buildInstallCommand('win32');

    expect(command.display).toContain('install.ps1');
    expect(command.display).toContain('irm');
    expect(command.file).toBe('powershell');
    expect(command.args).toContain('-NoProfile');
    expect(command.args.join(' ')).toContain('install.ps1');
    // Windows 上官方脚本靠 IsInputRedirected 判非交互，不需要脱离终端
    expect(command.detached).toBe(false);
  });

  it('macOS / Linux 走官方 install.sh', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const command = buildInstallCommand(platform);

      expect(command.display).toContain('install.sh');
      // 必须脱离控制终端：install.sh 用 `: <>/dev/tty` 判断终端，
      // 桥接是从终端启动的，不脱离就会卡在 [Y/n] 上等输入
      expect(command.detached).toBe(true);
      expect(command.file).toBe('sh');
    }
  });

  it('展示用的命令就是官方文档里那一条，可以直接复制到终端跑', () => {
    expect(buildInstallCommand('linux').display).toBe(
      'curl -fsSL https://pi.dev/install.sh | sh'
    );
    expect(buildInstallCommand('win32').display).toContain(
      'https://pi.dev/install.ps1'
    );
  });
});

describe('installPreflight', () => {
  const base: SetupStatus = {
    platform: 'linux',
    node: { version: 'v22.23.2', ok: true, minimum: '22.19.0' },
    npm: { available: true },
    pi: { installed: false, version: null },
    gitBash: { required: false, available: true },
    credentials: { providers: [] },
    ready: false,
    issues: [],
  };

  it('环境合规时允许代跑', () => {
    expect(installPreflight(base).allowed).toBe(true);
  });

  it('Node 版本不够时不允许代跑，并说明原因', () => {
    // 官方安装器在无 TTY 下不会自己装 Node，所以这里只能引导用户自己跑
    const status: SetupStatus = {
      ...base,
      node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' },
    };

    const result = installPreflight(status);

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('22.19.0');
  });

  it('没有 npm 时不允许代跑', () => {
    const status: SetupStatus = { ...base, npm: { available: false } };

    expect(installPreflight(status).allowed).toBe(false);
  });
});

describe('runInstall', () => {
  it('把输出去 ANSI、按回车切分后逐行回调', async () => {
    const { children, spawnInstaller } = harness();
    const lines: string[] = [];

    const running = runInstall({ platform: 'linux', onLine: l => lines.push(l) }, spawnInstaller);
    children[0].stdout.emit(
      'data',
      Buffer.from('\u001b[36mInstalling Pi...\u001b[0m\nresolving\rfetching (1)\r')
    );
    children[0].emit('close', 0);

    await expect(running).resolves.toEqual({ ok: true, code: 0 });
    expect(lines).toEqual(['Installing Pi...', 'resolving', 'fetching (1)']);
  });

  it('stdout 与 stderr 各自解码，多字节字符不会被劈开', async () => {
    const { children, spawnInstaller } = harness();
    const lines: string[] = [];

    const running = runInstall({ platform: 'linux', onLine: l => lines.push(l) }, spawnInstaller);
    const bytes = Buffer.from('安装完成\n', 'utf-8');
    // 4 落在「装」中间，确保跨块切分被正确拼回
    children[0].stdout.emit('data', bytes.subarray(0, 4));
    children[0].stdout.emit('data', bytes.subarray(4));
    children[0].stderr.emit('data', Buffer.from('警告：比较慢\n'));
    children[0].emit('close', 0);

    await running;
    expect(lines).toEqual(['安装完成', '警告：比较慢']);
  });

  it('非零退出码算失败，并带上退出码', async () => {
    const { children, spawnInstaller } = harness();

    const running = runInstall({ platform: 'linux', onLine: () => {} }, spawnInstaller);
    children[0].emit('close', 1);

    const result = await running;
    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(result.error).toContain('1');
  });

  it('启动失败时给出能看懂的提示', async () => {
    const { children, spawnInstaller } = harness();

    const running = runInstall({ platform: 'linux', onLine: () => {} }, spawnInstaller);
    children[0].emit('error', Object.assign(new Error('spawn powershell ENOENT'), { code: 'ENOENT' }));

    const result = await running;
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('取消时会结束进程并返回可读原因', async () => {
    const { children, spawnInstaller } = harness();
    const controller = new AbortController();

    const running = runInstall(
      { platform: 'linux', onLine: () => {}, signal: controller.signal },
      spawnInstaller
    );
    controller.abort();

    await expect(running).resolves.toMatchObject({ ok: false, error: '安装已取消' });
    expect(children[0].killed).toBe(true);
  });

  it('结束后再收到 close 不会重复结算', async () => {
    const { children, spawnInstaller } = harness();

    const running = runInstall({ platform: 'linux', onLine: () => {} }, spawnInstaller);
    children[0].emit('close', 0);
    children[0].emit('close', 1);

    await expect(running).resolves.toEqual({ ok: true, code: 0 });
  });
});
