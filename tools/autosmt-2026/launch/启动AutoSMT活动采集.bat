@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\scripts\enqueue-autosmt-job.ps1" inspect-activity-menus --checkpoint activity-menu-progress --timeout-ms 90000 --interval-ms 1800 --retries 8
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (
  echo Activity-menu capture was queued. Keep AutoSMT Session Guard open to run it.
) else (
  echo Unable to queue the activity-menu capture. Exit code: %RESULT%
)
pause
endlocal & exit /b %RESULT%
