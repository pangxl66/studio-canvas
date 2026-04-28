@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 npm，请先安装 Node.js: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo 正在安装依赖...
  call npm.cmd install
  if errorlevel 1 (
    echo [错误] npm install 失败
    pause
    exit /b 1
  )
)

echo 启动开发服务器并自动打开浏览器...
call npm.cmd run dev -- --host 127.0.0.1 --open
pause
