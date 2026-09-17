import * as path from 'path';
import { describe, expect, it } from 'vitest';
import type { RunCommand } from './env';
import { createPiLocator, resolvePiCommand, type FileExists } from './piLocate';

/** 只回答 `npm prefix -g`，其余命令当作不存在 */
const npmRunner = (prefix: string | null): RunCommand => async (command, args) => {
  if (command === 'npm' && args.join(' ') === 'prefix -g') return prefix;
  return null;
};

const existsIn = (paths: string[]): FileExists => target => paths.includes(target);

const win = path.win32;
const posix = path.posix;

describe('resolvePiCommand', () => {
  it('优先使用官方安装器显式指定的前缀（Unix）', async () => {
    const target = posix.join('/opt/npm', 'bin', 'pi');
    const command = await resolvePiCommand(npmRunner('/usr/lib/node_modules'), {
      platform: 'linux',
      env: { PI_NPM_INSTALL_PREFIX: '/opt/npm' },
      exists: existsIn([target]),
    });

    expect(command).toBe(target);
  });

  it('回退到 npm 全局前缀（Unix）', async () => {
    const target = posix.join('/usr/local', 'bin', 'pi');
    const command = await resolvePiCommand(npmRunner('/usr/local'), {
      platform: 'linux',
      env: {},
      exists: existsIn([target]),
    });

    expect(command).toBe(target);
  });

  it('npm 全局前缀不可写时官方安装器退到 ~/.local（Unix）', async () => {
    const target = posix.join('/home/u', '.local', 'bin', 'pi');
    const command = await resolvePiCommand(npmRunner('/usr'), {
      platform: 'darwin',
      env: {},
      homedir: '/home/u',
      exists: existsIn([target]),
    });

    expect(command).toBe(target);
  });

  it('Windows 上按候选顺序解析，pi 是 pi.cmd', async () => {
    const appData = win.join('C:\\Users\\u\\AppData\\Roaming', 'npm', 'pi.cmd');
    const command = await resolvePiCommand(npmRunner('C:\\npm'), {
      platform: 'win32',
      env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' },
      homedir: 'C:\\Users\\u',
      exists: existsIn([appData]),
    });

    expect(command).toBe(appData);
  });

  it('Windows 上认得官方安装器的 standalone Node 目录', async () => {
    const standalone = win.join('C:\\Users\\u\\AppData\\Local', 'pi-node', 'current', 'pi.cmd');
    const command = await resolvePiCommand(npmRunner(null), {
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' },
      homedir: 'C:\\Users\\u',
      exists: existsIn([standalone]),
    });

    expect(command).toBe(standalone);
  });

  it('候选里更靠前的存在时就用靠前的', async () => {
    const explicit = posix.join('/opt/npm', 'bin', 'pi');
    const npmPrefix = posix.join('/usr/local', 'bin', 'pi');
    const command = await resolvePiCommand(npmRunner('/usr/local'), {
      platform: 'linux',
      env: { PI_NPM_INSTALL_PREFIX: '/opt/npm' },
      exists: existsIn([explicit, npmPrefix]),
    });

    expect(command).toBe(explicit);
  });

  it('一个候选都不存在时返回 null（交给 PATH 兜底）', async () => {
    const command = await resolvePiCommand(npmRunner('/usr/local'), {
      platform: 'linux',
      env: {},
      homedir: '/home/u',
      exists: () => false,
    });

    expect(command).toBeNull();
  });

  it('npm 命令不可用时仍然能靠其它候选解析', async () => {
    const target = posix.join('/home/u', '.local', 'bin', 'pi');
    const command = await resolvePiCommand(npmRunner(null), {
      platform: 'linux',
      env: {},
      homedir: '/home/u',
      exists: existsIn([target]),
    });

    expect(command).toBe(target);
  });

  it('npm 输出带换行与空白也能用', async () => {
    const target = posix.join('/usr/local', 'bin', 'pi');
    const command = await resolvePiCommand(npmRunner('  /usr/local  \n'), {
      platform: 'linux',
      env: {},
      exists: existsIn([target]),
    });

    expect(command).toBe(target);
  });
});

describe('createPiLocator', () => {
  /** 前缀固定的 npm，并记录被问了几次 */
  const countingRunner = (prefix: string | null) => {
    const state = { npmCalls: 0 };
    const run: RunCommand = async (command, args) => {
      if (command === 'npm' && args.join(' ') === 'prefix -g') {
        state.npmCalls += 1;
        return prefix;
      }
      return null;
    };
    return { run, state };
  };

  it('解析成功后记住，不重复问 npm', async () => {
    // 向导每 5 秒轮询一次 get_setup_status，`npm prefix -g` 要起一个子进程，
    // 每次都重跑等于白白烧 CPU
    const target = posix.join('/usr/local', 'bin', 'pi');
    const { run, state } = countingRunner('/usr/local');
    const locator = createPiLocator(run, {
      platform: 'linux',
      env: {},
      exists: existsIn([target]),
    });

    expect(await locator.locate()).toBe(target);
    expect(await locator.locate()).toBe(target);
    expect(state.npmCalls).toBe(1);
    expect(locator.command).toBe(target);
  });

  it('失败不缓存：用户在自己的终端里刚装好，下次探测要能发现', async () => {
    // 这是「在终端里跑官方安装命令」那条路：桥接无从得知，只能靠重试
    const target = posix.join('/usr/local', 'bin', 'pi');
    const { run } = countingRunner('/usr/local');
    let installed = false;
    const locator = createPiLocator(run, {
      platform: 'linux',
      env: {},
      exists: () => installed,
    });

    expect(await locator.locate()).toBeNull();
    expect(locator.command).toBe('pi');

    installed = true;
    expect(await locator.locate()).toBe(target);
    expect(locator.command).toBe(target);
  });

  it('refresh 作废缓存：安装器可能把 pi 放到别的位置', async () => {
    const first = posix.join('/usr/local', 'bin', 'pi');
    // npm 全局目录不可写时官方安装器退到 ~/.local——换个位置的真实场景
    const second = posix.join('/home/u', '.local', 'bin', 'pi');
    const { run } = countingRunner('/usr/local');
    let candidates = [first];
    const locator = createPiLocator(run, {
      platform: 'linux',
      env: {},
      homedir: '/home/u',
      exists: target => candidates.includes(target),
    });

    expect(await locator.locate()).toBe(first);

    // 换到了新位置：不同步刷新的话，后续探测会一直报「还没安装 pi」
    candidates = [second];
    expect(await locator.locate()).toBe(first);
    expect(await locator.refresh()).toBe(second);
    expect(locator.command).toBe(second);
  });

  it('还没解析出来时 command 退回 PATH 里的 pi', () => {
    const { run } = countingRunner(null);
    const locator = createPiLocator(run, {
      platform: 'linux',
      env: {},
      exists: () => false,
    });

    expect(locator.command).toBe('pi');
  });
});
