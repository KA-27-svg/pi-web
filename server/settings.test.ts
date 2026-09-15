import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  readShellTool,
  shellToolFromSettings,
  withShellTool,
  writeShellTool,
} from './settings';

describe('shellToolFromSettings', () => {
  it('没有 defaultTools 时按 pi 的默认算（Windows 上是 bash）', () => {
    expect(shellToolFromSettings({})).toBe('bash');
    expect(shellToolFromSettings(undefined)).toBe('bash');
  });

  it('只开了 powershell 才算 powershell', () => {
    expect(shellToolFromSettings({ defaultTools: ['read', 'powershell', 'edit'] })).toBe(
      'powershell'
    );
  });

  it('两个都开着时以 bash 为准', () => {
    expect(
      shellToolFromSettings({ defaultTools: ['read', 'bash', 'powershell', 'edit'] })
    ).toBe('bash');
  });

  it('字段类型不对时不炸，按默认处理', () => {
    expect(shellToolFromSettings({ defaultTools: 'powershell' })).toBe('bash');
    expect(shellToolFromSettings({ defaultTools: null })).toBe('bash');
  });
});

describe('withShellTool', () => {
  it('切到 powershell 时把 bash 换掉，其余内置工具保持标准顺序', () => {
    const next = withShellTool({ theme: 'dark' }, 'powershell');

    expect(next.defaultTools).toEqual(['read', 'powershell', 'edit', 'write']);
    // 用户别的设置一个都不能动
    expect(next.theme).toBe('dark');
  });

  it('切回 bash 也是同样的形状', () => {
    expect(withShellTool({ defaultTools: ['read', 'powershell', 'edit', 'write'] }, 'bash').defaultTools).toEqual([
      'read',
      'bash',
      'edit',
      'write',
    ]);
  });

  it('用户自己开过的其它内置工具不会被丢掉', () => {
    const next = withShellTool({ defaultTools: ['read', 'bash', 'grep', 'find'] }, 'powershell');

    expect(next.defaultTools).toContain('grep');
    expect(next.defaultTools).toContain('find');
    expect(next.defaultTools).not.toContain('bash');
  });

  it('不碰扩展工具——它们不由 defaultTools 管', () => {
    // exa_* 这类来自扩展，不该被写进 defaultTools
    const next = withShellTool({}, 'powershell');
    expect(next.defaultTools).not.toContain('exa_search');
  });

  it('文件里是垃圾内容时给一个干净的默认结构，而不是崩掉', () => {
    expect(withShellTool(null, 'bash')).toEqual({
      defaultTools: ['read', 'bash', 'edit', 'write'],
    });
  });
});

describe('读写 settings.json', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-web-settings-'));
    file = path.join(dir, 'settings.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('文件不存在时按默认值读，不报错', async () => {
    await expect(readShellTool(file)).resolves.toBe('bash');
  });

  it('写进去再读回来是同一个值', async () => {
    await writeShellTool('powershell', file);
    await expect(readShellTool(file)).resolves.toBe('powershell');

    await writeShellTool('bash', file);
    await expect(readShellTool(file)).resolves.toBe('bash');
  });

  it('只动 defaultTools，用户其它设置原样保留', async () => {
    await fs.writeFile(
      file,
      JSON.stringify({
        theme: 'dark',
        defaultModel: 'deepseek-flash',
        compaction: { enabled: true },
      }),
      'utf-8'
    );

    await writeShellTool('powershell', file);

    const written = JSON.parse(await fs.readFile(file, 'utf-8'));
    expect(written).toMatchObject({
      theme: 'dark',
      defaultModel: 'deepseek-flash',
      compaction: { enabled: true },
      defaultTools: ['read', 'powershell', 'edit', 'write'],
    });
  });

  it('文件不是合法 JSON 时直接报错，绝不覆盖用户的手写配置', async () => {
    await fs.writeFile(file, '{ 这是坏掉的 json', 'utf-8');

    await expect(writeShellTool('powershell', file)).rejects.toThrow(/合法 JSON/);
    await expect(fs.readFile(file, 'utf-8')).resolves.toBe('{ 这是坏掉的 json');
  });

  it('空文件按空对象处理', async () => {
    await fs.writeFile(file, '   \n', 'utf-8');

    await writeShellTool('powershell', file);

    expect(JSON.parse(await fs.readFile(file, 'utf-8')).defaultTools).toContain('powershell');
  });
});
