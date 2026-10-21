@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0" || exit /b 1
set "APP_DIR=%CD%"

set "ELECTRON=%APP_DIR%\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" (
  echo [video-overlay] Electron dependency is missing. Installing project dependencies...
  where npm.cmd >nul 2>nul
  if errorlevel 1 (
    echo [video-overlay] Node.js and npm are required. Install Node.js, then run this script again.
    exit /b 1
  )
  call npm.cmd install --no-audit --no-fund
  if errorlevel 1 (
    echo [video-overlay] Dependency installation failed. Check the network and npm output above.
    exit /b 1
  )
)

if not exist "%ELECTRON%" (
  echo [video-overlay] Electron was not installed at "%ELECTRON%".
  exit /b 1
)

start "" "%ELECTRON%" "%APP_DIR%"
exit /b 0
