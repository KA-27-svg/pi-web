<#
  Pi Web 启动器。

  逻辑放在 PowerShell 而不是 start.bat 里是有原因的：cmd.exe 解析较长的批处理
  文件时，如果文件里有多字节字符（中文），再配合 chcp 65001，会让它的读取位置
  错位——实测 rem / echo 里的中文会把下一行的开头吃掉，报出一堆「不是内部或外部
  命令」。.bat 里只留一个纯 ASCII 的壳，问题就不存在了。

  PowerShell 脚本文件则必须存成 UTF-8 with BOM：Windows PowerShell 5.1 默认按
  ANSI 解码脚本，不带 BOM 时中文会把语法撑坏。
#>

param(
  [Parameter(Mandatory = $true)][string]$ProjectDir
)

$ErrorActionPreference = 'Stop'
# 调用方可能带结尾反斜杠（%~dp0 就带），去掉再用
$ProjectDir = $ProjectDir.TrimEnd('\')
Set-Location -LiteralPath $ProjectDir

$Port = 3001
$Url = "http://127.0.0.1:$Port"

function Wait-ForExit {
  Write-Host ''
  Read-Host '按回车关闭' | Out-Null
}

Write-Host ''
Write-Host '  ============================================'
Write-Host '    Pi Web  -  Pi Agent 可视化工作台'
Write-Host '  ============================================'
Write-Host ''

# ── Node ────────────────────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '  [错误] 没有找到 Node.js，请先安装 Node 22.19.0 或更高版本。'
  Wait-ForExit
  exit 1
}

# ── 桌面快捷方式 ─────────────────────────────────────────────────────────────
# 放在最前面：就算后面构建失败，图标也已经有了
$shortcutScript = Join-Path $ProjectDir 'tools\create-shortcut.ps1'
if (Test-Path $shortcutScript) {
  & $shortcutScript -ProjectDir $ProjectDir
}

# ── 已经开着服务？ ───────────────────────────────────────────────────────────
# 3001 有人听不代表就是我们：开发模式的 npm run dev 也用这个端口，改动前的旧桥接
# 更是只会在 / 上吐一段 JSON。所以看响应类型：项目页面是 text/html。
function Test-AppServing {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "$Url/" -TimeoutSec 3
    return $response.Headers['Content-Type'] -match 'text/html'
  } catch {
    return $false
  }
}

if (Test-AppServing) {
  Write-Host '  服务已经在运行，直接打开页面。'
  Start-Process $Url
  Wait-ForExit
  exit 0
}

$portBusy = $null -ne (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($portBusy) {
  # 端口被占但不是我们的页面：最常见是一个 npm run dev 的窗口还开着
  Write-Host "  [提示] $Port 端口被别的进程占着，而且它不是本项目的页面。"
  Write-Host ''
  Write-Host '     最常见的原因：还有一个 npm run dev 的窗口开着（开发模式也用这个端口）。'
  Write-Host ''
  Write-Host '     想用界面  ->  关掉那个窗口，再双击本脚本'
  Write-Host '     想改代码  ->  直接用它开的 http://localhost:5173'
  Wait-ForExit
  exit 1
}

# ── 依赖 ────────────────────────────────────────────────────────────────────
if (-not (Test-Path (Join-Path $ProjectDir 'node_modules'))) {
  Write-Host '  首次运行，正在安装依赖，可能需要几分钟...'
  Write-Host ''
  & npm install
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host '  [错误] 依赖安装失败，请检查网络后重试。'
    Wait-ForExit
    exit 1
  }
  Write-Host ''
}

Write-Host '  正在构建，首次会慢一些...'
Write-Host ''

# 后台等端口真的起来再开浏览器，否则用户先看到的是「无法访问」。
# 用 /api/status 而不是 /：它不受前端路由回落影响，响应也小。
$waiter = '$end=(Get-Date).AddSeconds(180); while((Get-Date) -lt $end){ try { $null = Invoke-WebRequest -UseBasicParsing ' + $Url + '/api/status -TimeoutSec 2; Start-Process ''' + $Url + '''; exit } catch { Start-Sleep -Milliseconds 500 } }'
Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList '-NoProfile', '-Command', $waiter

# npm start = 构建 + 起服务；前端由桥接托管，只有一个进程、一个端口
& npm start

Write-Host ''
Write-Host '  服务已停止。'
Wait-ForExit
