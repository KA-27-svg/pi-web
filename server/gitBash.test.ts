import { describe, expect, it } from 'vitest';
import type { RunCommand } from './env';
import { GIT_BASH_DEFAULT, findGitBash } from './gitBash';

/** 记录问过哪些命令，用来断言查找顺序 */
function recordingRunner(outputs: Record<string, string>) {
  const asked: string[] = [];
  const run: RunCommand = async command => {
    asked.push(command);
    return outputs[command] ?? null;
  };
  return { run, asked };
}

describe('findGitBash', () => {
  it('settings.json 的 shellPath 优先，哪怕别的候选也能跑', async () => {
    // 用户显式指到 Cygwin / MSYS2 时，不该因为我们自己找了个 Git Bash 就无视他
    const { run, asked } = recordingRunner({
      'C:\\cygwin64\\bin\\bash.exe': 'GNU bash, version 5.2.26\n',
      [GIT_BASH_DEFAULT]: 'GNU bash, version 5.2.26\n',
      bash: 'GNU bash, version 5.2.26\n',
    });

    const found = await findGitBash(run, {
      platform: 'win32',
      shellPath: 'C:\\cygwin64\\bin\\bash.exe',
    });

    expect(found).toEqual({ available: true, path: 'C:\\cygwin64\\bin\\bash.exe' });
    expect(asked).toEqual(['C:\\cygwin64\\bin\\bash.exe']);
  });

  it('没有 shellPath 时找 Git for Windows 的默认位置', async () => {
    // 这就是「装了 Git 但没勾加入 PATH」那个场景：以前会报假的「缺 Git Bash」
    const { run, asked } = recordingRunner({
      [GIT_BASH_DEFAULT]: 'GNU bash, version 5.2.26\n',
    });

    const found = await findGitBash(run, { platform: 'win32' });

    expect(found).toEqual({ available: true, path: GIT_BASH_DEFAULT });
    expect(asked).toEqual([GIT_BASH_DEFAULT]);
  });

  it('前两个都没有才回退到 PATH 上的 bash', async () => {
    const { run, asked } = recordingRunner({ bash: 'GNU bash, version 5.2.26\n' });

    const found = await findGitBash(run, { platform: 'win32' });

    expect(found).toEqual({ available: true, path: 'bash' });
    expect(asked).toEqual([GIT_BASH_DEFAULT, 'bash']);
  });

  it('文件在但跑不起来时不算可用', async () => {
    // PATH 上的 C:\Windows\system32\bash.exe 是 WSL 的壳，没装发行版时执行会失败。
    // 只 stat 一下就会把它当成可用，然后用户在 pi 真正调用时才撞墙
    const run: RunCommand = async () => null;

    const found = await findGitBash(run, { platform: 'win32' });

    expect(found).toEqual({ available: false, path: null });
  });

  it('一个都不通时返回不可用，而不是抛错', async () => {
    const { run } = recordingRunner({});

    await expect(findGitBash(run, { platform: 'win32' })).resolves.toEqual({
      available: false,
      path: null,
    });
  });

  it('非 Windows 上不去找硬编码的 Git 路径', async () => {
    const { run, asked } = recordingRunner({ bash: 'GNU bash, version 5.2.26\n' });

    const found = await findGitBash(run, { platform: 'linux' });

    expect(found).toEqual({ available: true, path: 'bash' });
    expect(asked).toEqual(['bash']);
  });

  it('shellPath 是空白字符串时忽略它，不拿空串去执行', async () => {
    const { run, asked } = recordingRunner({ [GIT_BASH_DEFAULT]: 'GNU bash, version 5.2.26\n' });

    await findGitBash(run, { platform: 'win32', shellPath: '   ' });

    expect(asked).toEqual([GIT_BASH_DEFAULT]);
  });
});
