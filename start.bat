@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo   ============================================
echo     Pi Web  -  Pi Agent 可视化工作台
echo   ============================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [错误] 没有找到 Node.js，请先安装 Node 22.19.0 或更高版本。
  echo.
  pause
  exit /b 1
)

rem 服务已经在跑就不要再起一个，直接开页面。
rem 只认 3001：生产模式下前端由桥接自己托管，没有 5173 那个进程了。
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo   服务已经在运行，直接打开页面。
  echo.
  start "" http://127.0.0.1:3001
  pause
  exit /b 0
)

if not exist "node_modules" (
  echo   首次运行，正在安装依赖，可能需要几分钟...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [错误] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
  echo.
)

echo   正在构建，首次会慢一些...
echo.

rem 后台等端口真的起来再开浏览器，否则会先看到「无法访问」
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "$end=(Get-Date).AddSeconds(180); while((Get-Date) -lt $end){ try { $null = Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3001/api/status -TimeoutSec 2; Start-Process http://127.0.0.1:3001; exit } catch { Start-Sleep -Milliseconds 500 } }"

rem npm start = 构建 + 起服务，前端由桥接托管，只有一个进程、一个端口
call npm start

echo.
echo   服务已停止。
pause
