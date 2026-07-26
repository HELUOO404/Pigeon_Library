@echo off
setlocal
title AutoSMT Session Guard
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\run-autosmt-session-worker.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
echo AutoSMT Session Guard stopped. Exit code: %RESULT%
pause
endlocal & exit /b %RESULT%
