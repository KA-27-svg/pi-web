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

# ── 准备清单 ────────────────────────────────────────────────────────────────
# 首次运行要等几分钟，中间没有任何反馈的话，用户很容易以为卡死了。所以把要做的
# 事按顺序列出来，每步报一次用时——下次他就知道总共要等多久。
#
# 顺序打印而不是原地重画：重画要控制光标，而输出被重定向时（管道、日志）
# [Console]::SetCursorPosition 会直接抛错。
$TotalSteps = 4
$StepIndex = 0
$StepWatch = [System.Diagnostics.Stopwatch]::StartNew()

function Start-Step {
  param([string]$Name)
  $script:StepIndex += 1
  $script:StepWatch.Restart()
  Write-Host ("  [{0}/{1}] {2}" -f $script:StepIndex, $TotalSteps, $Name)
}

function Complete-Step {
  # 标记用 ASCII：控制台默认是 GBK，`✓`（U+2713）不在里面，会渲染成 `?`
  param([string]$Result, [string]$Mark = 'OK')

  $seconds = [int][math]::Round($script:StepWatch.Elapsed.TotalSeconds)
  # 不到一秒的不报用时（否则一排「0 秒」只是噪声），分钟级才写成「x 分 y 秒」
  $elapsed = if ($seconds -lt 1) { '' }
             elseif ($seconds -ge 60) { '，用时 {0} 分 {1} 秒' -f [int]($seconds / 60), ($seconds % 60) }
             else { "，用时 $seconds 秒" }

  Write-Host ("        {0}  {1}{2}" -f $Mark, $Result, $elapsed)
  Write-Host ''
}

Write-Host '  第一次运行要几分钟，之后就不用再等了。'
Write-Host ''

# ── Node ────────────────────────────────────────────────────────────────────
# pi 需要 Node ≥ 22.19.0，而本项目自己只要 22.12 就能跑——所以「网页能开」不等于
# 「能用」，这个空档必须在这里补上：本机没有达标 Node 时，下一份官方 zip 解压到
# runtime\node 并插到 PATH 最前面。
#
# 装到项目目录而不是系统，是因为：不需要管理员权限、不改系统 PATH、不和 nvm /
# fnm / volta 打架、删掉 runtime\ 就等于卸载干净。
#
# 这里也是整条链上唯一能装 Node 的地方：桥接自己就跑在 Node 上，没有 Node 的机器
# 根本到不了网页，也就抳不到任何页面上的按钮。
$NodeMinimum = [version]'22.19.0'
$NodeDistBase = 'https://nodejs.org/dist/latest-v22.x'
$LocalNodeDir = Join-Path $ProjectDir 'runtime\node'
$LocalNodeExe = Join-Path $LocalNodeDir 'node.exe'

function Get-NodeVersion {
  param([string]$Exe)

  if (-not (Get-Command $Exe -ErrorAction SilentlyContinue)) { return $null }

  try {
    return [version]((& $Exe '--version').TrimStart('v'))
  } catch {
    return $null
  }
}

function Get-Sha256 {
  param([string]$Path)

  # 直接用 .NET 而不是 Get-FileHash：本机实测 Microsoft.PowerShell.Utility 被外部
  # 工具（scoop 装的 pwsh）改过，导出的命令里根本没有 Get-FileHash，正常环境也会
  # 报 CommandNotFound。加密与压缩这两块由 .NET Framework 保证，不受 PSModulePath 影响。
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
  } finally {
    $stream.Dispose()
    $sha.Dispose()
  }
}

function Install-LocalNode {
  # 老 PowerShell 默认走 TLS 1.0，而 nodejs.org 只收 TLS 1.2+。不设这一行会得到
  # 一句和「版本」毫不相干的连接错误。（官方安装器里也做了同样的事）
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

  $arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    'ARM64' { 'arm64' }
    'x86'   { 'x86' }
    default { 'x64' }
  }
  $suffix = "win-$arch.zip"

  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) "pi-web-node-$PID"
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null

  try {
    # 先取官方公布的校验清单，从里面挑出要下的文件名。
    # 版本号硬编码在脚本里会过期，而 latest-v22.x 是官方一直维护的指向。
    $sumsPath = Join-Path $tmp 'SHASUMS256.txt'
    Invoke-WebRequest -UseBasicParsing -Uri "$NodeDistBase/SHASUMS256.txt" -OutFile $sumsPath

    $pattern = "^\S+\s+node-v[\d.]+-$([regex]::Escape($suffix))$"
    $line = Get-Content -LiteralPath $sumsPath | Where-Object { $_ -match $pattern } | Select-Object -First 1
    if (-not $line) { throw "官方校验清单里没有 $suffix 的条目" }

    $parts = @($line.Trim() -split '\s+')
    $expected = $parts[0]
    $fileName = $parts[1]
    $zipPath = Join-Path $tmp $fileName

    Write-Host "        正在下载 $fileName ..."
    Invoke-WebRequest -UseBasicParsing -Uri "$NodeDistBase/$fileName" -OutFile $zipPath

    # 校验 SHA256：下载坏、中途被换包，都在这里拦住，
    # 而不是等到解压出一堆坏文件才报错
    $actual = Get-Sha256 -Path $zipPath
    if ($actual -ne $expected.ToUpperInvariant()) {
      throw "下载的 $fileName 校验不通过（期望 $expected，实际 $actual）"
    }

    Write-Host '        校验通过，正在解压...'
    # 同样不用 Expand-Archive（它住在一个可能被改掉的模块里）。
    # 解到子目录而不是 $tmp：ExtractToDirectory 碰到同名文件会直接报错，
    # 而 SHASUMS256.txt 和 zip 本体就在 $tmp 里
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $extractDir = Join-Path $tmp 'x'
    New-Item -ItemType Directory -Force -Path $extractDir | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $extractDir)

    # zip 里套着一层 node-v22.x.y-win-x64\，把它整体搬到 runtime\node
    $inner = Join-Path $extractDir ($fileName -replace '\.zip$', '')
    Remove-Item -LiteralPath $LocalNodeDir -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $LocalNodeDir) | Out-Null
    Move-Item -LiteralPath $inner -Destination $LocalNodeDir
  } finally {
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }

  # 插到最前面：后面所有 node / npm 都会用这一份（只影响本进程，不改系统）
  $env:PATH = "$LocalNodeDir;$env:PATH"
}

Start-Step 'Node.js'

$systemNode = Get-NodeVersion 'node'
# 本地那份也验版本再用：只看「文件在不在」的话，之前中断过的安装或以后提高门槛时
# 都会静默用一个不达标的 Node
$localNode = Get-NodeVersion $LocalNodeExe

if ($localNode -and $localNode -ge $NodeMinimum) {
  # 本地优先：这个项目的 Node 从哪来就是确定的，不受用户系统环境影响
  $env:PATH = "$LocalNodeDir;$env:PATH"
  $nodeSummary = "v$localNode（项目自带）"
} elseif ($systemNode -and $systemNode -ge $NodeMinimum) {
  # 系统那份够用，不白白再装 100 MB
  $nodeSummary = "v$systemNode（用系统已装的）"
} else {
  if ($localNode) {
    Write-Host "        项目自带的 Node 是 v$localNode，pi 需要 $NodeMinimum 或更新"
  } elseif ($systemNode) {
    Write-Host "        系统 Node 是 v$systemNode，pi 需要 $NodeMinimum 或更新"
  } else {
    Write-Host '        这台机器上还没有 Node.js'
  }
  Write-Host '        正在下载一份到本项目目录（约 34 MB，不动系统 PATH）...'
  Write-Host ''

  try {
    Install-LocalNode
  } catch {
    Write-Host ''
    Write-Host "  [错误] 自动安装 Node 失败：$_"
    Write-Host '  请手动装上 Node 22.19.0 或更高版本后重试：https://nodejs.org/'
    Wait-ForExit
    exit 1
  }

  # `node --version` 自己就带 `v` 前缀，别再加一个
  $nodeSummary = "$(& $LocalNodeExe --version)（刚下了一份到项目目录）"
}

Complete-Step $nodeSummary

# ── pi ──────────────────────────────────────────────────────────────────────
# 检测 + 没装就装。放在这个位置而不是紧挨着 Node，是为了让「服务已经在跑」那条
# 快速路径不受影响——那种情况下页面上的向导自己会处理缺 pi。
#
# 直接让 npm 装，而不跑官方安装器：pi 本身就是一个 npm 包，而官方安装器的核心也
# 就是这一句。不跑它的原因有两个：
#   1. 它有交互提问（要不要装 Git Bash、要不要改 PATH），自动化流程里会卡住；
#   2. 它开头那些判断在无终端环境下本来就会跳过 Node / Git Bash，拿不到好处。
# 装失败不阻断：页面上的「帮我安装 pi」还在，用户有别的路可走。
function Get-PiVersion {
  if (-not (Get-Command pi -ErrorAction SilentlyContinue)) { return $null }
  try { return (& pi '--version').Trim() } catch { return $null }
}

Start-Step 'pi'

$piVersion = Get-PiVersion
if ($piVersion) {
  Complete-Step "$piVersion（已经装好）"
} else {
  Write-Host '        没找到，正在安装（约 22 MB 下载 + 142 MB 依赖）...'
  Write-Host ''
  & npm install -g --ignore-scripts --min-release-age=0 @earendil-works/pi-coding-agent
  Write-Host ''

  # 以探测为准，不是退出码：npm 可能因为与安装无关的告警返回非零，
  # 而 pi 其实已经装好了
  $piAfter = Get-PiVersion
  if ($piAfter) {
    Complete-Step "$piAfter（刚装好）"
  } else {
    # 不阻断：页面上的「帮我安装 pi」还在，用户有别的路可走
    Complete-Step '没装好，打开页面后可以在向导里再试一次' '!!'
  }
}

# ── 依赖 ────────────────────────────────────────────────────────────────────
# 这里起 npm 就是前面刚接进 PATH 的那份 Node，所以它必然是达标的
Start-Step '项目依赖'

# 判据不能只看目录在不在：npm install 装到一半断掉，同样会留下 node_modules。
# 那样下次启动就会一直说「已经有了」，然后构建失败成一句看不懂的
# 「'tsc' 不是内部或外部命令」——而且双击多少次都一样，用户出不来。
# npm 成功装完会写 node_modules\.package-lock.json，拿它当「装完整了」的凭据。
$nodeModules = Join-Path $ProjectDir 'node_modules'
$installMarker = Join-Path $nodeModules '.package-lock.json'

if (Test-Path $installMarker) {
  Complete-Step '已经有了'
} else {
  # 有残留先清掉：半成品留着只会让 npm 更难判断该补什么
  Remove-Item -LiteralPath $nodeModules -Recurse -Force -ErrorAction SilentlyContinue

  Write-Host '        正在安装，可能需要几分钟...'
  Write-Host ''
  & npm install

  if ($LASTEXITCODE -ne 0 -or -not (Test-Path $installMarker)) {
    # 失败也不留残留：留着下次启动会跳过安装，再报一个看不出真因的构建错误
    Remove-Item -LiteralPath $nodeModules -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Host '  [错误] 依赖安装失败（多半是网络），已清掉装了一半的内容。'
    Write-Host '         检查网络后再双击一次即可重试。'
    Wait-ForExit
    exit 1
  }

  Complete-Step '已安装'
}

Start-Step '构建'
Write-Host '        首次会慢一些...'
Write-Host ''

& npm run build
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host '  [错误] 构建失败。原因在上面的输出里。'
  Write-Host '         第一次跑的话，先删掉 node_modules 目录再双击一次（重装依赖）。'
  Wait-ForExit
  exit 1
}
Complete-Step '已完成'

# 后台等端口真的起来再开浏览器，否则用户先看到的是「无法访问」。
# 用 /api/status 而不是 /：它不受前端路由回落影响，响应也小。
$waiter = '$end=(Get-Date).AddSeconds(180); while((Get-Date) -lt $end){ try { $null = Invoke-WebRequest -UseBasicParsing ' + $Url + '/api/status -TimeoutSec 2; Start-Process ''' + $Url + '''; exit } catch { Start-Sleep -Milliseconds 500 } }'
Start-Process -WindowStyle Hidden -FilePath 'powershell' -ArgumentList '-NoProfile', '-Command', $waiter

Write-Host '  准备完成。正在启动服务，浏览器会自动打开。'
Write-Host '  这个窗口留着别关——关掉它就等于停掉服务。'
Write-Host ''

# 分开跑 build / serve，而不是一句 npm start：npm start 会一直阻塞到服务退出，
# 「构建」就没法作为清单里的一步报出结果。两条命令 package.json 里都有。
& npm run serve

Write-Host ''
Write-Host '  服务已停止。'
Wait-ForExit
