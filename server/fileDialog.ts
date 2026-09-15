import { spawn } from 'child_process';

/** 用户可能在对话框前犹豫很久，给足时间；超时才会杀掉进程 */
export const DIALOG_TIMEOUT_MS = 5 * 60_000;

export interface PickOptions {
  /** 只挑选图片（对话框的过滤器） */
  imagesOnly?: boolean;
  multiple?: boolean;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnCapture = (command: string, args: string[]) => Promise<SpawnResult>;

const IMAGE_GLOB = '*.png;*.jpg;*.jpeg;*.gif;*.webp;*.bmp';

/**
 * 让 PowerShell 进程变成 DPI 感知。**必须在创建任何窗口之前调用**：一旦创建过窗口，
 * Windows 就把这个进程的 DPI 感知锁死了。
 *
 * 不设的话，高分屏上整个对话框会被 Windows 位图拉伸——比如 2880×1800 / 200% 缩放的屏，
 * 进程只看到 1440×900，对话框被放大 2 倍，字和图标都是糊的。
 *
 * 依次尝试：每屏 v2（Win10 1703+）→ 每屏（Win8.1+）→ 系统感知（Vista+）。
 */
const DPI_AWARENESS = [
  "$api = Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value); [DllImport(\"shcore.dll\")] public static extern int SetProcessDpiAwareness(int value); [DllImport(\"user32.dll\")] public static extern bool SetProcessDPIAware();' -Name DpiApi -Namespace Win32 -PassThru",
  'try { [void]$api::SetProcessDpiAwarenessContext([IntPtr](-4)) } catch { try { [void]$api::SetProcessDpiAwareness(2) } catch { [void]$api::SetProcessDPIAware() } }',
].join('; ');

/**
 * Windows 上用 PowerShell 调 WinForms 的原生对话框。
 *
 * 脚本是**静态字符串**：选项只切换我们自己写死的片段，不拼接任何外部输入，
 * 所以没有注入面。`[Console]::OutputEncoding` 必须设，否则中文文件名会乱码。
 * 顶部那个 TopMost 的隐藏窗体是为了让对话框能跑到浏览器前面来。
 */
function windowsCommand(options: PickOptions): { command: string; args: string[] } {
  const filter = options.imagesOnly
    ? `图片 (${IMAGE_GLOB})|${IMAGE_GLOB}|所有文件 (*.*)|*.*`
    : '所有文件 (*.*)|*.*';

  const script = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Windows.Forms',
    DPI_AWARENESS,
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog',
    "$dialog.Title = '选择要发给 Pi 的文件'",
    `$dialog.Multiselect = $${options.multiple === false ? 'false' : 'true'}`,
    `$dialog.Filter = '${filter}'`,
    '$owner = New-Object System.Windows.Forms.Form',
    '$owner.TopMost = $true',
    'if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {',
    '  $dialog.FileNames | ForEach-Object { Write-Output $_ }',
    '}',
  ].join('; ');

  return {
    command: 'powershell',
    args: ['-NoProfile', '-STA', '-Command', script],
  };
}

export function dialogCommand(
  platform: NodeJS.Platform,
  options: PickOptions
): { command: string; args: string[] } {
  if (platform === 'win32') return windowsCommand(options);

  throw new Error('系统文件选择框目前只在 Windows 上实现');
}

/** 每行一个路径；空行丢掉（取消时输出为空） */
export function parseDialogOutput(stdout: string): string[] {
  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

const defaultSpawn: SpawnCapture = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // 已经退出了
      }
      reject(new Error('选择文件超时'));
    }, DIALOG_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

/**
 * 弹出系统原生的文件选择框，返回用户选中的**绝对路径**。
 *
 * 这是这一整套附件功能的关键：浏览器出于安全拿不到本地路径，但桥接就跑在同一台
 * 机器上，可以替用户弹一个原生对话框。于是「选文件」不需要复制任何字节——
 * 选中的文件还待在原地，我们只是知道了它在哪。
 *
 * 用户取消时返回空数组。
 */
export async function pickFiles(
  options: PickOptions = {},
  deps: { spawn?: SpawnCapture; platform?: NodeJS.Platform } = {}
): Promise<string[]> {
  const platform = deps.platform ?? process.platform;
  const run = deps.spawn ?? defaultSpawn;

  const { command, args } = dialogCommand(platform, options);
  const result = await run(command, args);

  if (!result.stdout.trim() && result.stderr.trim()) {
    throw new Error(`选择文件失败：${result.stderr.trim().slice(0, 200)}`);
  }

  return parseDialogOutput(result.stdout);
}
