@echo off
rem Starts the server so phones on the same Wi-Fi can open the registration page (local queue mode).
rem The LAN address to put in the QR code is printed below. Windows may ask to allow Node.js through the firewall.
rem Optional: set OPERATOR_KEY=yourkey before starting, so only staff can call / complete tickets.
cd /d "%~dp0"
set HOST=0.0.0.0
node server\server.mjs
pause
