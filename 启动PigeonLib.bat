@echo off
setlocal enableextensions
rem PigeonLib launcher (pure ASCII English). Self-contained: no PowerShell needed.
rem Starts BOTH the optional sync backend (port 8787) and the frontend dev server (port 5173).
rem The backend enables account login + cross-device sync; the app still works locally without it.
cd /d "%~dp0"

echo ============================================
echo   PigeonLib Launcher
echo ============================================
echo.

echo [1/6] Checking Node.js / npm ...
where node >nul 2>&1
if errorlevel 1 (
  echo   [X] node not found. Install Node.js and add it to PATH.
  echo       Download: https://nodejs.org/
  goto :fail
)
where npm >nul 2>&1
if errorlevel 1 (
  echo   [X] Found node but not npm. Reinstall Node.js with npm.
  goto :fail
)
for /f "delims=" %%v in ('node -v') do echo   [OK] node %%v
echo.

echo [2/6] Checking built-in course package ...
if not exist "dist-courses\ic-packaging.pigeon" (
  echo   Not found, building ic-packaging ...
  call node tools\build-pigeon.mjs ic-packaging
  if errorlevel 1 (
    echo   [X] Build failed, see the error above.
    goto :fail
  )
)
echo   [OK] dist-courses\ic-packaging.pigeon
echo.

echo [3/6] Checking frontend dependencies ...
if not exist "app\node_modules" (
  echo   First run, installing frontend dependencies ^(~1-2 min^) ...
  call npm --prefix app install
  if errorlevel 1 (
    echo   [X] npm install failed in app, see the error above.
    goto :fail
  )
)
echo   [OK] frontend dependencies ready
echo.

echo [4/6] Freeing ports 8787 and 5173 ^(killing any stale PigeonLib processes^) ...
call :freeport 8787
call :freeport 5173
echo   [OK] ports cleared, will reuse the same ports
echo.

echo [5/6] Starting sync backend ^(port 8787^) ...
if not exist "server\node_modules" (
  echo   First run, installing backend dependencies ...
  call npm --prefix server install
  if errorlevel 1 (
    echo   [X] npm install failed in server. The app will still run locally without sync.
  )
)
if not exist "server\.env" (
  if exist "server\.env.example" copy /Y "server\.env.example" "server\.env" >nul
)
rem Launch backend in its own window so it keeps running alongside the frontend.
rem Use start /D to set the working dir (avoids fragile nested quotes).
start "PigeonLib Backend" /D "%~dp0server" cmd /k node --disable-warning=ExperimentalWarning index.js
echo   [OK] backend starting in a separate window  http://localhost:8787
echo.

echo [6/6] Starting frontend  http://localhost:5173  ...
echo       Browser opens automatically; keep this window open to keep serving.
echo       Close BOTH windows to stop everything.
echo.
call npm --prefix app run dev

echo.
echo [PigeonLib] Frontend server has exited.
goto :end

:fail
echo.
echo Launch failed. Read the message above.

:end
echo.
pause
endlocal
goto :eof

rem ---- subroutine: free one TCP port by killing the PID that LISTENs on it ----
rem %1 = port number. Matches the local-address ":<port> " then the LISTENING state,
rem so ":5173 " never matches ":51730" and foreign-address ports are ignored.
:freeport
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /C:":%~1 " ^| findstr /C:"LISTENING"') do (
  echo   freeing port %~1 ^(stopping PID %%P^)
  taskkill /F /PID %%P >nul 2>&1
)
goto :eof
