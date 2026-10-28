@echo off
title Prashnaa - Controller Server
cd /d "%~dp0"
echo ============================================================
echo   Starting Prashnaa Controller Dashboard...
echo ============================================================
start "" "http://localhost:3000/?mode=controller"
node server.js
pause
