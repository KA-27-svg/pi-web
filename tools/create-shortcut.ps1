<#
  在桌面创建（或修正）「Pi Web」快捷方式。

  为什么需要它：.lnk 里存的是绝对路径，提交进仓库到别人机器上就是错的；而 .ico
  只是图片，双击它不会启动任何东西。所以「下载完就有一个能点的图标」这件事，只能
  由本地脚本在第一次运行时生成。

  调用：powershell -NoProfile -ExecutionPolicy Bypass -File tools\create-shortcut.ps1 -ProjectDir "C:\path\to\pi web"
#>

param(
  [Parameter(Mandatory = $true)][string]$ProjectDir,
  # 默认真实桌面；测试时指向临时目录，免得碰用户的桌面
  [string]$DesktopPath = [Environment]::GetFolderPath('Desktop')
)

$ErrorActionPreference = 'Stop'

$target = Join-Path $ProjectDir 'start.bat'
$icon = Join-Path $ProjectDir 'pi-web.ico'
$shortcutPath = Join-Path $DesktopPath 'Pi Web.lnk'

if (-not (Test-Path $target)) {
  Write-Host '  没找到 start.bat，跳过创建快捷方式。'
  exit 0
}

if (-not (Test-Path $DesktopPath)) {
  Write-Host "  桌面目录不存在（$DesktopPath），跳过创建快捷方式。"
  exit 0
}

$shell = New-Object -ComObject WScript.Shell

# 已经存在且指向正确就别动它：用户可能自己调过图标或绑过快捷键
if (Test-Path $shortcutPath) {
  $existing = $shell.CreateShortcut($shortcutPath)
  if ($existing.TargetPath -eq $target) {
    exit 0
  }
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $ProjectDir
$shortcut.Description = 'Pi Web — Pi Agent 可视化工作台'
if (Test-Path $icon) {
  $shortcut.IconLocation = "$icon,0"
}
$shortcut.Save()

Write-Host '  已在桌面创建快捷方式：Pi Web'
