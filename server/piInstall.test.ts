import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { describe, expect, it, vi } from 'vitest';
import type { SetupStatus } from './env';
import {
  buildInstallCommand,
  classifyInstallOutcome,
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
    gitBash: { required: false, available: true, path: null, mode: 'bash' },
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

  it('Windows 上的「Node 版本不够」引导用户重启，而不是让他去终端装', () => {
    // launch.ps1 的 Ensure-Node 会在下次启动时装好达标的 Node；
    // 这里再说「请到终端自己跑一次」就是过时的、且多此一举的
    const status: SetupStatus = {
      ...base,
      platform: 'win32',
      node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' },
    };

    const reason = installPreflight(status).reason ?? '';

    expect(reason).toContain('重新打开');
    // 不能再用 Unix 那句话，它在这条路上是多余的
    expect(reason).not.toContain('终端');
  });

  it('Unix 上的「Node 版本不够」仍然给终端命令（没有启动脚本可以托底）', () => {
    const status: SetupStatus = {
      ...base,
      platform: 'linux',
      node: { version: 'v20.19.0', ok: false, minimum: '22.19.0' },
    };

    const reason = installPreflight(status).reason ?? '';

    expect(reason).toContain('终端');
    expect(reason).not.toContain('重新打开');
  });

  it('没有 npm 时不允许代跑', () => {
    const status: SetupStatus = { ...base, npm: { available: false } };

    expect(installPreflight(status).allowed).toBe(false);
  });
});

describe('classifyInstallOutcome', () => {
  it('安装器成功时就是成功', () => {
    expect(classifyInstallOutcome({ ok: true, code: 0 }, true)).toEqual({ ok: true });
  });

  it('安装器报了失败、但 pi 其实已经能跑时算成功，并留一条提示', () => {
    // 真实复现过：官方安装器在 npm install -g 成功之后还有收尾步骤
    // （配置 PowerShell shim 的执行策略等），那些步骤失败会让整个脚本以非零码退出。
    // 只看退出码就会把「装好了」判成「装失败了」，页面上同时出现
    // 红色【安装失败】和已经就绪的状态。
    const outcome = classifyInstallOutcome({ ok: false, code: 1, error: '安装器以退出码 1 结束' }, true);

    expect(outcome.ok).toBe(true);
    expect(outcome.error).toBeUndefined();
    // 不能静默吞掉：真出问题时这条是唯一线索
    expect(outcome.notice).toContain('退出码 1');
  });

  it('安装器报了失败、pi 也确实不在时才算真失败，并给出原因', () => {
    const outcome = classifyInstallOutcome(
      { ok: false, code: 1, error: '安装器以退出码 1 结束' },
      false
    );

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('安装器以退出码 1 结束');
    expect(outcome.notice).toBeUndefined();
  });

  it('退出码都没有时也能拼出一句可读的失败原因', () => {
    const outcome = classifyInstallOutcome({ ok: false, code: null }, false);

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
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
