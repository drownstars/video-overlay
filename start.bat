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

"%ELECTRON%" "%APP_DIR%"
set "APP_EXIT_CODE=%ERRORLEVEL%"
if not "%APP_EXIT_CODE%"=="0" (
  echo [video-overlay] Electron exited with code %APP_EXIT_CODE%.
  pause
)
exit /b %APP_EXIT_CODE%
