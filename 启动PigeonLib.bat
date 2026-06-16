@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   PigeonLib 启动器
echo ============================================
echo.

echo [1/4] 检测 Node.js / npm ...
where node >nul 2>nul
if errorlevel 1 (
  echo   [X] 未找到 node。请确认已安装 Node.js 且加入系统 PATH。
  echo       注意:Git Bash 里能用,不代表此 cmd 窗口也能,二者 PATH 不同。
  echo       下载地址 https://nodejs.org/
  goto :fail
)
where npm >nul 2>nul
if errorlevel 1 (
  echo   [X] 找到 node 但未找到 npm。请重装 Node.js 并确保含 npm。
  goto :fail
)
for /f "delims=" %%v in ('node -v') do echo   [OK] node %%v
echo.

echo [2/4] 检查内置课程包 ...
if not exist "dist-courses\ic-packaging.pigeon" (
  echo   未找到,正在打包 ic-packaging ...
  node tools\build-pigeon.mjs ic-packaging
  if errorlevel 1 (
    echo   [X] 打包失败,请看上面报错。
    goto :fail
  )
)
echo   [OK] dist-courses\ic-packaging.pigeon
echo.

echo [3/4] 检查依赖 ...
cd app
if not exist "node_modules" (
  echo   首次运行,安装依赖,约 1-2 分钟 ...
  call npm install
  if errorlevel 1 (
    echo   [X] npm install 失败,请看上面报错。
    goto :fail
  )
)
echo   [OK] 依赖就绪
echo.

echo [4/4] 启动本地服务器 http://localhost:5173 ,浏览器将自动打开 ...
echo       保持此窗口开启;关闭窗口即停止服务器。
echo.
call npm run dev

echo.
echo [PigeonLib] 服务器已退出。
goto :end

:fail
echo.
echo *** 启动失败 *** 请把以上信息截图反馈。

:end
echo.
pause
