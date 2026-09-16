@echo off
chcp 65001 >nul
title SnakeMatch3 Address
cd /d "%~dp0.."
where node >nul 2>nul || goto :nonode
node run\run.js address
goto :end

:nonode
echo.
echo   [ERROR] Node.js not found. Install it first: https://nodejs.org
echo.

:end
echo.
pause
