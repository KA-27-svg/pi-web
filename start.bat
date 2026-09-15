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
  echo   [错误] 没有找到 Node.js，请先安装 Node 22 或更高版本。
  echo.
  pause
  exit /b 1
)

rem 服务已经在跑就不要再起一个，直接开页面
powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if not errorlevel 1 (
  echo   服务已经在运行，直接打开页面。
  echo.
  start "" http://localhost:5173
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

echo   前端界面:  http://localhost:5173
echo   桥接服务:  ws://localhost:3001
echo.
echo   关闭此窗口即停止服务。
echo.

rem 后台等端口真的起来再开浏览器，否则会先看到「无法访问」
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "$end=(Get-Date).AddSeconds(90); while((Get-Date) -lt $end){ try { $null = Invoke-WebRequest -UseBasicParsing http://localhost:5173/ -TimeoutSec 2; Start-Process http://localhost:5173; exit } catch { Start-Sleep -Milliseconds 500 } }"

call npm run dev

echo.
echo   服务已停止。
pause
