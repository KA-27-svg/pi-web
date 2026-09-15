import { describe, expect, it, vi } from 'vitest';
import { dialogCommand, parseDialogOutput, pickFiles } from './fileDialog';

describe('dialogCommand', () => {
  it('Windows 上走 PowerShell + WinForms，并开启多选', () => {
    const { command, args } = dialogCommand('win32', {});

    expect(command).toBe('powershell');
    expect(args).toContain('-STA');
    const script = args.join(' ');
    expect(script).toContain('System.Windows.Forms.OpenFileDialog');
    expect(script).toContain('$dialog.Multiselect = $true');
  });

  it('强制 UTF-8 输出，否则中文文件名会乱码', () => {
    const script = dialogCommand('win32', {}).args.join(' ');
    expect(script).toContain('OutputEncoding');
  });

  it('要求单图时收窄过滤器', () => {
    const script = dialogCommand('win32', { imagesOnly: true }).args.join(' ');
    expect(script).toContain('*.png');

    const all = dialogCommand('win32', {}).args.join(' ');
    expect(all).not.toContain('*.png');
  });

  it('脚本里不拼接任何外部输入', () => {
    // imagesOnly 只切换两段写死的过滤器文本，没有插值
    const script = dialogCommand('win32', { imagesOnly: true }).args.join(' ');
    expect(script).not.toContain('undefined');
    expect(script).not.toContain('null');
  });

  it('其它平台明确报「还没实现」，而不是假装能用', () => {
    expect(() => dialogCommand('darwin', {})).toThrow(/只在 Windows/);
    expect(() => dialogCommand('linux', {})).toThrow(/只在 Windows/);
  });
});

describe('parseDialogOutput', () => {
  it('每行一个路径，去掉空行与首尾空白', () => {
    expect(parseDialogOutput('C:\\a.txt\n\n  C:\\b.txt  \n')).toEqual(['C:\\a.txt', 'C:\\b.txt']);
  });

  it('用户取消时是空的', () => {
    expect(parseDialogOutput('')).toEqual([]);
    expect(parseDialogOutput('\n\n')).toEqual([]);
  });

  it('中文与空格路径原样保留', () => {
    expect(parseDialogOutput('C:\\Users\\me\\Desktop\\年度 报告.docx\n')).toEqual([
      'C:\\Users\\me\\Desktop\\年度 报告.docx',
    ]);
  });
});

describe('pickFiles', () => {
  it('把选中的路径返回给调用方', async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: 'C:\\a.png\nC:\\b.png\n', stderr: '' }));

    const picked = await pickFiles({}, { spawn, platform: 'win32' });

    expect(picked).toEqual(['C:\\a.png', 'C:\\b.png']);
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('用户取消（没有输出、也没有错误）返回空数组，不当成失败', async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));

    expect(await pickFiles({}, { spawn, platform: 'win32' })).toEqual([]);
  });

  it('对话框起不来时把 stderr 带出来，便于排查', async () => {
    const spawn = vi.fn(async () => ({
      code: 1,
      stdout: '',
      stderr: 'Add-Type : 找不到 System.Windows.Forms',
    }));

    await expect(pickFiles({}, { spawn, platform: 'win32' })).rejects.toThrow(/Windows.Forms/);
  });

  it('非 Windows 平台直接抛错', async () => {
    await expect(pickFiles({}, { platform: 'darwin' })).rejects.toThrow(/只在 Windows/);
  });
});
