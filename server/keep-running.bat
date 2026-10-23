@echo off
rem Runs server.mjs and starts it again if it stops (a crash, or a lost connection that ends it).
rem Started minimized by start.bat. Closing this window stops the server for good, and with it the
rem booth's queue and the NFC check-in checker, so leave it open during the exhibition.
cd /d "%~dp0\.."
title voyage-server (keep this window open)
:loop
node server\server.mjs
echo.
echo [%date% %time%] server stopped (exit code %errorlevel%), restarting in 3 seconds...
timeout /t 3 /nobreak >nul
goto loop
