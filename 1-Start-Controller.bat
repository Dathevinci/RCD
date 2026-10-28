@echo off
title RemoteAssist - Controller Server
cd /d "%~dp0"
echo ============================================================
echo   Starting RemoteAssist Controller Dashboard...
echo ============================================================
start "" "http://localhost:3000/?mode=controller"
node server.js
pause
