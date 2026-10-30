@echo off
rem Runs server.ts and starts it again if it stops (a crash, or a lost connection that ends it).
rem Started minimized by start.bat. Closing this window stops the server for good, and with it the
rem booth's queue and the NFC check-in checker, so leave it open during the exhibition.
cd /d "%~dp0\.."
title voyage-server (keep this window open)

rem Node 24 or newer runs the TypeScript server directly; an older one would fail on every restart.
for /f "tokens=1 delims=v." %%v in ('node -v 2^>nul') do set NODE_MAJOR=%%v
if not defined NODE_MAJOR (
  echo Node.js was not found. Install Node.js 24 or newer from https://nodejs.org/ and start again.
  pause
  exit /b 1
)
if %NODE_MAJOR% LSS 24 (
  echo Node.js 24 or newer is needed, this PC has %NODE_MAJOR%. Install it from https://nodejs.org/ and start again.
  pause
  exit /b 1
)

rem the server serves the built pages in dist\; build them once if they are missing
if not exist dist\build.json (
  echo Building the pages first ^(npm run build^)...
  call npm run build
  if errorlevel 1 (
    echo The build failed. Run "npm install" and then "npm run build" in this folder.
    pause
    exit /b 1
  )
)

:loop
node server\server.ts
echo.
echo [%date% %time%] server stopped (exit code %errorlevel%), restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
