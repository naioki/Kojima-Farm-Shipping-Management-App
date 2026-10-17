@echo off
title Kojima Noen Dev Server
cd /d C:\dev\kojima-noen

echo.
echo  === Starting dev server... ===
echo  Press Ctrl+C to stop
echo.

start /b cmd /c "timeout /t 12 /nobreak >nul && start http://localhost:3000/admin"

npm run dev

pause
