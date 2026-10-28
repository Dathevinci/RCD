@echo off
title RemoteAssist - Simple Partner Helper
cd /d "%~dp0"
echo ============================================================
echo   Starting Simple Partner Screen Share + Mouse Helper...
echo   (Close this window or press SPACE anytime to stop control)
echo ============================================================
start "" "http://localhost:3000/partner.html"
node host-agent.js
pause
