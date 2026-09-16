import { describe, expect, it } from 'vitest';
import {
  MINIMUM_NODE_TEXT,
  meetsMinimumNode,
  parseNodeVersion,
  probeEnvironment,
  type RunCommand,
} from './env';

/** 假执行器：按命令名给结果，没给的命令当作「不存在」 */
function runnerFor(outputs: Record<string, string | null>): RunCommand {
  return async command => {
    const value = outputs[command];
    return value === undefined ? null : value;
  };
}

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
    const status = await probeEnvironment(runnerFor(healthy), { platform: 'linux' });

    expect(status.ready).toBe(true);
    expect(status.issues).toEqual([]);
    expect(status.pi).toEqual({ installed: true, version: '0.85.1' });
    expect(status.node).toEqual({ version: 'v22.23.2', ok: true, minimum: MINIMUM_NODE_TEXT });
  });

  it('缺 pi 时 ready 为假并给出可读原因', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, pi: null }), { platform: 'linux' });

    expect(status.ready).toBe(false);
    expect(status.issues.map(i => i.code)).toEqual(['pi-missing']);
  });

  it('Node 版本过低与缺失是两种不同的问题项', async () => {
    const old = await probeEnvironment(runnerFor({ ...healthy, node: 'v20.19.0\n' }), {
      platform: 'linux',
    });
    expect(old.ready).toBe(false);
    expect(old.issues.map(i => i.code)).toEqual(['node-too-old']);
    expect(old.node.ok).toBe(false);
    // 报错要说清现状与门槛，否则用户不知道差多少
    expect(old.issues[0].message).toContain('20.19.0');
    expect(old.issues[0].message).toContain(MINIMUM_NODE_TEXT);

    const missing = await probeEnvironment(runnerFor({ ...healthy, node: null }), {
      platform: 'linux',
    });
    expect(missing.issues.map(i => i.code)).toEqual(['node-missing']);
  });

  it('缺 npm 单独报一项（官方安装器要用它装 pi）', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, npm: null }), {
      platform: 'linux',
    });

    expect(status.npm.available).toBe(false);
    expect(status.issues.map(i => i.code)).toEqual(['npm-missing']);
  });

  it('非 Windows 平台不检查 Git Bash', async () => {
    const status = await probeEnvironment(runnerFor({ ...healthy, bash: null }), {
      platform: 'linux',
    });

    expect(status.gitBash).toEqual({ required: false, available: true });
    expect(status.issues).toEqual([]);
  });

  it('Windows 上缺 Git Bash 要报出来，但不阻断对话', async () => {
    // Git Bash 只影响 pi 的 bash 工具，装没装 pi 判定的还是 pi 自己
    const status = await probeEnvironment(runnerFor({ ...healthy, bash: null }), {
      platform: 'win32',
    });

    expect(status.gitBash).toEqual({ required: true, available: false });
    expect(status.issues.map(i => i.code)).toContain('git-bash-missing');
    expect(status.ready).toBe(true);
  });

  it('多个问题按固定顺序返回，便于界面稳定展示', async () => {
    const status = await probeEnvironment(runnerFor({ pi: null }), { platform: 'win32' });

    expect(status.issues.map(i => i.code)).toEqual([
      'node-missing',
      'npm-missing',
      'pi-missing',
      'git-bash-missing',
    ]);
  });
});
