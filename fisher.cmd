@echo off
rem Fisher ERP for Windows: double-click to install (needs Docker Desktop). Other commands: fisher.cmd help
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fisher.ps1" %*
set "code=%errorlevel%"
if "%~1"=="" pause
exit /b %code%
