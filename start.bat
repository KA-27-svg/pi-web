@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo   ============================================
echo     pi-web  Pi Agent 可视化工作台
echo   ============================================
echo.
echo   前端界面:  http://localhost:5173
echo   桥接服务:  ws://localhost:3001
echo.
echo   关闭此窗口即停止服务。
echo   ============================================
echo.

start "" http://localhost:5173

npm run dev

pause
