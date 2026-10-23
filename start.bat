@echo off
rem Exhibit launcher: starts the local server and opens Chrome in kiosk (fullscreen) mode.
rem The server restarts by itself if it stops (server\keep-running.bat); keep its minimized window open.
rem To quit: Alt+F4 closes the browser, then close the minimized server window.
cd /d "%~dp0"
start "voyage-server" /min cmd /c server\keep-running.bat
timeout /t 1 /nobreak >nul

set URL=http://localhost:8000
set CHROME="%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not exist %CHROME% set CHROME="%LocalAppData%\Google\Chrome\Application\chrome.exe"

if exist %CHROME% (
  rem --use-fake-ui-for-media-stream skips the camera permission prompt
  start "" %CHROME% --kiosk --use-fake-ui-for-media-stream --autoplay-policy=no-user-gesture-required --user-data-dir="%TEMP%\voyage-kiosk" %URL%
) else (
  start "" %URL%
)
