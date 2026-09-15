import { describe, expect, it, vi } from 'vitest';
import { openCommand, openWithSystem } from './openFile';

describe('openCommand', () => {
  it('Windows 上把路径放进环境变量，不拼进命令行', () => {
    const target = 'C:\\Users\\me\\Desktop\\年度 报告.docx';
    const { command, args, env } = openCommand('win32', target);

    expect(command).toBe('powershell');
    expect(env?.PI_OPEN_TARGET).toBe(target);
    // 路径一个字符都不该出现在命令行里
    expect(args.join(' ')).not.toContain(target);
    expect(args.join(' ')).not.toContain('报告');
  });

  it('文件名里的 cmd 特殊字符不会造成注入', () => {
    // 这种文件名在 Windows 上合法；如果用 `cmd /c start`，`&` 会去执行 calc
    const evil = 'C:\\tmp\\付款&calc.txt';
    const { args, env } = openCommand('win32', evil);

    expect(env?.PI_OPEN_TARGET).toBe(evil);
    expect(args.join(' ')).not.toContain('calc');
    expect(args.join(' ')).not.toContain('&');
  });

  it('走 Start-Process，才会用文件关联打开', () => {
    const script = openCommand('win32', 'C:/a.txt').args.join(' ');
    expect(script).toContain('Start-Process');
    // 必须用 -FilePath：-LiteralPath 是 PowerShell 7 才有的，5.1 上会直接报错
    expect(script).toContain('-FilePath');
    expect(script).not.toContain('-LiteralPath');
  });

  it('macOS 与 Linux 用各自的原生命令，路径作为独立参数', () => {
    expect(openCommand('darwin', '/tmp/a b.pdf')).toEqual({
      command: 'open',
      args: ['/tmp/a b.pdf'],
    });
    expect(openCommand('linux', '/tmp/a b.pdf')).toEqual({
      command: 'xdg-open',
      args: ['/tmp/a b.pdf'],
    });
  });
});

describe('openWithSystem', () => {
  it('把命令与路径如实交给 spawn', async () => {
    const spawn = vi.fn<
      (command: string, args: string[], env?: NodeJS.ProcessEnv) => Promise<void>
    >(async () => {});

    await openWithSystem('C:\\a.txt', { spawn, platform: 'win32' });

    expect(spawn).toHaveBeenCalledTimes(1);
    const [command, args, env] = spawn.mock.calls[0];
    expect(command).toBe('powershell');
    expect(env?.PI_OPEN_TARGET).toBe('C:\\a.txt');
    expect(args).toContain('-NoProfile');
  });

  it('起不来时把错误抛给调用方', async () => {
    const spawn = vi.fn(async () => {
      throw new Error('spawn powershell ENOENT');
    });

    await expect(openWithSystem('C:\\a.txt', { spawn, platform: 'win32' })).rejects.toThrow(
      /ENOENT/
    );
  });
});
