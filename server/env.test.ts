import { describe, expect, it } from 'vitest';
import {
  MINIMUM_NODE_TEXT,
  meetsMinimumNode,
  parseNodeVersion,
  probeEnvironment,
  quoteIfNeeded,
  type RunCommand,
} from './env';

/** 假执行器：按命令名给结果，没给的命令当作「不存在」 */
function runnerFor(outputs: Record<string, string | null>): RunCommand {
  return async command => {
    const value = outputs[command];
    return value === undefined ? null : value;
  };
}

// 凭证必须注入：不注入就会去读宿主机真实的 ~/.pi/agent，测试结果随机器漂移
const noCredentials = async () => [] as string[];
const withAnthropic = async () => ['anthropic'];
// shellPath 同理：不注入就会去读宿主机真实的 settings.json
const noShellPath = async () => null;
const noDefaultTools = async () => null;

describe('parseNodeVersion', () => {
  it('解析标准的 node --version 输出', () => {
    expect(parseNodeVersion('v22.19.0')).toEqual({ major: 22, minor: 19, patch: 0 });
    expect(parseNodeVersion('22.19.0')).toEqual({ major: 22, minor: 19, patch: 0 });
    expect(parseNodeVersion('v20.19.5\n')).toEqual({ major: 20, minor: 19, patch: 5 });
  });

  it('缺失的 minor / patch 按 0 处理（与官方安装器的宽松解析一致）', () => {
    expect(parseNodeVersion('v22')).toEqual({ major: 22, minor: 0, patch: 0 });
    expect(parseNodeVersion('v22.19')).toEqual({ major: 22, minor: 19, patch: 0 });
  });

  it('识别不了时返回 null，而不是抛错', () => {
    expect(parseNodeVersion('')).toBeNull();
    expect(parseNodeVersion('command not found')).toBeNull();
  });
});

describe('meetsMinimumNode', () => {
  it('接受 22.19.0 及更新', () => {
    expect(meetsMinimumNode({ major: 22, minor: 19, patch: 0 })).toBe(true);
    expect(meetsMinimumNode({ major: 22, minor: 19, patch: 1 })).toBe(true);
    expect(meetsMinimumNode({ major: 22, minor: 20, patch: 0 })).toBe(true);
    expect(meetsMinimumNode({ major: 23, minor: 0, patch: 0 })).toBe(true);
  });

  it('拒绝 22.19.0 之前的版本', () => {
    expect(meetsMinimumNode({ major: 22, minor: 18, patch: 99 })).toBe(false);
    expect(meetsMinimumNode({ major: 21, minor: 99, patch: 0 })).toBe(false);
    expect(meetsMinimumNode({ major: 20, minor: 19, patch: 0 })).toBe(false);
  });

  it('读不出版本等同于不满足', () => {
    expect(meetsMinimumNode(null)).toBe(false);
  });
});

describe('probeEnvironment', () => {
  const healthy: Record<string, string | null> = {
    node: 'v22.23.2\n',
    npm: '10.9.8\n',
    pi: '0.85.1\n',
    bash: 'GNU bash, version 5.2.26\n',
  };

  it('全部就绪时 ready 为真且没有问题项', async () => {
    const status = await probeEnvironment(runnerFor(healthy), {
      platform: 'linux',
      listCredentials: withAnthropic,
    });

    expect(status.ready).toBe(true);
    expect(status.issues).toEqual([]);
    expect(status.pi).toEqual({ installed: true, version: '0.85.1' });
    expect(status.credentials.providers).toEqual(['anthropic']);
    expect(status.node).toEqual({ version: 'v22.23.2', ok: true, minimum: MINIMUM_NODE_TEXT });
  });

  it('缺 pi 时 ready 为假并给出可读原因', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, pi: null }), {
      platform: 'linux',
      listCredentials: withAnthropic,
    });

    expect(status.ready).toBe(false);
    expect(status.issues.map(i => i.code)).toEqual(['pi-missing']);
  });

  it('Node 版本过低与缺失是两种不同的问题项', async () => {
    const old = await probeEnvironment(runnerFor({ ...healthy, node: 'v20.19.0\n' }), {
      platform: 'linux',
      listCredentials: withAnthropic,
    });
    expect(old.ready).toBe(false);
    expect(old.issues.map(i => i.code)).toEqual(['node-too-old']);
    expect(old.node.ok).toBe(false);
    // 报错要说清现状与门槛，否则用户不知道差多少
    expect(old.issues[0].message).toContain('20.19.0');
    expect(old.issues[0].message).toContain(MINIMUM_NODE_TEXT);

    const missing = await probeEnvironment(runnerFor({ ...healthy, node: null }), {
      platform: 'linux',
      listCredentials: withAnthropic,
    });
    expect(missing.issues.map(i => i.code)).toEqual(['node-missing']);
  });

  it('缺 npm 单独报一项（官方安装器要用它装 pi）', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, npm: null }), {
      platform: 'linux',
      listCredentials: withAnthropic,
    });

    expect(status.npm.available).toBe(false);
    expect(status.issues.map(i => i.code)).toEqual(['npm-missing']);
  });

  it('非 Windows 平台不检查 Git Bash', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, bash: null }), {
      platform: 'linux',
      listCredentials: withAnthropic,
    });

    expect(status.gitBash).toEqual({ required: false, available: true, path: null, mode: 'bash' });
    expect(status.issues).toEqual([]);
  });

  it('Windows 上缺 Git Bash 要报出来，但不阻断对话', async () => {
    // Git Bash 只影响 pi 的 bash 工具，装没装 pi 判定的还是 pi 自己
    const status = await probeEnvironment(runnerFor({ ...healthy, bash: null }), {
      platform: 'win32',
      listCredentials: withAnthropic,
      readShellPath: noShellPath,
      readDefaultTools: noDefaultTools,
    });

    expect(status.gitBash).toEqual({ required: true, available: false, path: null, mode: 'powershell' });
    expect(status.issues.map(i => i.code)).toContain('git-bash-missing');
    expect(status.ready).toBe(true);
  });

  it('已经无 bash 可用的机器上，提示说的是「已改用 PowerShell」而不是「你自己去装」', async () => {
    // 桥接启动时会把默认工具集里的 bash 换成 powershell（toolFallback.ts），
    // 所以这时候让用户去装 Git Bash 是多余的要求——实际已经能跑命令了
    const status = await probeEnvironment(runnerFor({ ...healthy, bash: null }), {
      platform: 'win32',
      listCredentials: withAnthropic,
      readShellPath: noShellPath,
      readDefaultTools: noShellPath,
    });

    const issue = status.issues.find(i => i.code === 'git-bash-missing');

    expect(issue?.message).toContain('PowerShell');
    expect(issue?.message).toContain('不需要装任何东西');
  });

  it('用户的 defaultTools 是自定义的时候，提示不能声称「已改用 PowerShell」', async () => {
    // 我们没动他的配置，说「已改用」就是假话
    const status = await probeEnvironment(runnerFor({ ...healthy, bash: null }), {
      platform: 'win32',
      listCredentials: withAnthropic,
      readShellPath: noShellPath,
      readDefaultTools: async () => ['read', 'edit'],
    });

    const issue = status.issues.find(i => i.code === 'git-bash-missing');

    expect(status.gitBash.mode).toBe('bash');
    expect(issue?.message).not.toContain('已改用');
    expect(issue?.message).toContain('自定义');
  });

  it('defaultTools 已经换成 powershell 时，mode 报 powershell', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, bash: null }), {
      platform: 'win32',
      listCredentials: withAnthropic,
      readShellPath: noShellPath,
      readDefaultTools: async () => ['read', 'powershell', 'edit', 'write'],
    });

    expect(status.gitBash.mode).toBe('powershell');
  });

  it('settings.json 里指了 shellPath 就用它，哪怕别的候选也能跑', async () => {
    // 用户装了 Cygwin / MSYS2 并显式指定了路径，pi 用的就是它。
    // 我们报成另一个的话，界面上说的和 pi 实际用的就对不上了
    const cygwin = 'C:\\cygwin64\\bin\\bash.exe';
    const run: RunCommand = async (command, args) => {
      if (args.join(' ') !== '--version') return null;
      if (command === cygwin) return 'GNU bash, version 5.2.26\n';
      return healthy[command] ?? null;
    };

    const status = await probeEnvironment(run, {
      platform: 'win32',
      listCredentials: withAnthropic,
      readShellPath: async () => cygwin,
      readDefaultTools: noDefaultTools,
    });

    expect(status.gitBash).toEqual({ required: true, available: true, path: cygwin, mode: 'bash' });
    expect(status.issues.map(i => i.code)).not.toContain('git-bash-missing');
  });

  it('PATH 上没有 bash、但 Git for Windows 装在默认位置时不再误报缺失', async () => {
    // 这是本次要修的核心。pi 自己会去 C:\Program Files\Git\bin\bash.exe 找，
    // 而以前我们只跑 PATH 上的 `bash --version`——用户装 Git 时没勾「加入 PATH」
    // 就会看到一个假的「缺 Git Bash」，照着做也修不好
    const gitBashPath = 'C:\\Program Files\\Git\\bin\\bash.exe';
    const run: RunCommand = async (command, args) => {
      if (args.join(' ') !== '--version') return null;
      if (command === gitBashPath) return 'GNU bash, version 5.2.26\n';
      if (command === 'bash') return null; // PATH 上就是没有
      return healthy[command] ?? null;
    };

    const status = await probeEnvironment(run, {
      platform: 'win32',
      listCredentials: withAnthropic,
      readShellPath: noShellPath,
      readDefaultTools: noDefaultTools,
    });

    expect(status.gitBash.path).toBe(gitBashPath);
    expect(status.issues.map(i => i.code)).not.toContain('git-bash-missing');
    expect(status.ready).toBe(true);
  });

  it('多个问题按固定顺序返回，便于界面稳定展示', async () => {
    const status = await probeEnvironment(runnerFor({ pi: null }), {
      platform: 'win32',
      listCredentials: noCredentials,
      readShellPath: noShellPath,
      readDefaultTools: noDefaultTools,
    });

    expect(status.issues.map(i => i.code)).toEqual([
      'node-missing',
      'npm-missing',
      'pi-missing',
      'git-bash-missing',
    ]);
  });

  it('装了 pi 但没配凭证时同样不算就绪', async () => {
    // 这是最容易踩的一种：pi 装好了、网页也能开，但发消息永远没有回复
    const status = await probeEnvironment(runnerFor(healthy), {
      platform: 'linux',
      listCredentials: noCredentials,
    });

    expect(status.ready).toBe(false);
    expect(status.issues.map(i => i.code)).toEqual(['no-credentials']);
    expect(status.credentials.providers).toEqual([]);
  });

  it('没装 pi 时不报「没配凭证」，免得问题项重复堆叠', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, pi: null }), {
      platform: 'linux',
      listCredentials: noCredentials,
    });

    expect(status.issues.map(i => i.code)).toEqual(['pi-missing']);
  });

  it('用传入的 piCommand 探测，而不是固定走 PATH 里的 pi', async () => {
    // 「装到 PATH 之外」的核心场景：官方安装器只把新目录写进用户 PATH，
    // 已经在跑的桥接进程读不到。探测必须真的执行那个绝对路径，
    // 否则装成功也会一直报 pi-missing，用户点一次按钮就重装一次。
    const absolute = 'C:\\Users\\u\\AppData\\Local\\pi-node\\current\\pi.cmd';
    const seen: string[] = [];
    const run: RunCommand = async (command, args) => {
      seen.push(command);
      if (command === absolute && args.join(' ') === '--version') return '0.85.1\n';
      if (command === 'node') return healthy.node;
      if (command === 'npm') return healthy.npm;
      return null; // PATH 里的裸 `pi` 找不到
    };

    const status = await probeEnvironment(run, {
      platform: 'linux',
      listCredentials: withAnthropic,
      piCommand: absolute,
    });

    expect(seen).toContain(absolute);
    expect(seen).not.toContain('pi');
    expect(status.pi).toEqual({ installed: true, version: '0.85.1' });
    expect(status.ready).toBe(true);
  });

  it('没传 piCommand 时退回 PATH 里的 pi（已装机器的行为不变）', async () => {
    const seen: string[] = [];
    const run: RunCommand = async command => {
      seen.push(command);
      return healthy[command] ?? null;
    };

    const status = await probeEnvironment(run, {
      platform: 'linux',
      listCredentials: withAnthropic,
    });

    expect(seen).toContain('pi');
    expect(status.pi.installed).toBe(true);
  });
});

describe('quoteIfNeeded', () => {
  it('路径带空格时加引号，否则 shell 会从空格处断开', () => {
    // 不加引号的实测后果：`C:\Users\John Doe\...\pi.cmd --version`
    // 会被 cmd 当成执行 `C:\Users\John`
    expect(quoteIfNeeded('C:\\Users\\John Doe\\pi.cmd')).toBe('"C:\\Users\\John Doe\\pi.cmd"');
  });

  it('没有空格时原样返回', () => {
    expect(quoteIfNeeded('pi')).toBe('pi');
    expect(quoteIfNeeded('/usr/local/bin/pi')).toBe('/usr/local/bin/pi');
  });
});
