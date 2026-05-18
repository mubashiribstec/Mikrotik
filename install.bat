@echo off
REM ############################################################################
REM NetForge - Automated Installation & Startup Script for Windows
REM
REM This script automatically:
REM - Checks for Node.js installation
REM - Installs dependencies
REM - Configures the application
REM - Starts the server
REM ############################################################################

setlocal enabledelayedexpansion

REM Color codes (requires Windows 10+)
set "GREEN=[92m"
set "RED=[91m"
set "YELLOW=[93m"
set "BLUE=[94m"
set "NC=[0m"

REM Configuration
set "SCRIPT_DIR=%cd%"
set "APP_PORT=3001"
set "LOG_FILE=%SCRIPT_DIR%\netforge.log"
set "CONFIG_DIR=%USERPROFILE%\.netforge"
set "CONFIG_FILE=%CONFIG_DIR%\config.bat"

echo.
echo ========================================
echo NetForge - Automated Installation
echo ========================================
echo.

REM Check Node.js
echo Checking Node.js installation...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed
    echo.
    echo Please install Node.js from: https://nodejs.org/
    echo Download LTS version and install it
    echo.
    echo After installation, run this script again
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('node --version') do set "NODE_VERSION=%%i"
    echo [OK] Node.js installed: !NODE_VERSION!
)

REM Check npm
echo Checking npm installation...
npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed
    pause
    exit /b 1
) else (
    for /f "tokens=*" %%i in ('npm --version') do set "NPM_VERSION=%%i"
    echo [OK] npm installed: !NPM_VERSION!
)

echo.
echo Installing dependencies...
if exist "node_modules" (
    echo [INFO] Dependencies already installed, skipping...
) else (
    npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
)

REM Load or create config
echo.
echo ========================================
echo MikroTik Router Configuration
echo ========================================
echo.

if exist "!CONFIG_FILE!" (
    echo Found existing configuration
    call "!CONFIG_FILE!"
    echo.
    echo Router Name: !ROUTER_NAME!
    echo Host: !ROUTER_HOST!:!ROUTER_PORT!
    echo Username: !ROUTER_USER!
    echo.
    set /p USE_SAVED="Use this configuration? (y/n): "
    if /i not "!USE_SAVED!"=="y" (
        goto :configure_router
    )
) else (
    goto :configure_router
)

goto :skip_configure

:configure_router
echo.
echo Enter your MikroTik router connection details:
echo (These will be stored locally for convenience)
echo.

set /p ROUTER_HOST="Router IP Address (default: 192.168.88.1): "
if "!ROUTER_HOST!"=="" set "ROUTER_HOST=192.168.88.1"

set /p ROUTER_PORT="SSH Port (default: 22): "
if "!ROUTER_PORT!"=="" set "ROUTER_PORT=22"

set /p ROUTER_USER="Username (default: admin): "
if "!ROUTER_USER!"=="" set "ROUTER_USER=admin"

set /p ROUTER_PASS="Password: "

set /p ROUTER_NAME="Display name for this router (default: Main Router): "
if "!ROUTER_NAME!"=="" set "ROUTER_NAME=Main Router"

REM Save configuration
if not exist "!CONFIG_DIR!" mkdir "!CONFIG_DIR!"

(
    echo @echo off
    echo setlocal enabledelayedexpansion
    echo set "ROUTER_HOST=!ROUTER_HOST!"
    echo set "ROUTER_PORT=!ROUTER_PORT!"
    echo set "ROUTER_USER=!ROUTER_USER!"
    echo set "ROUTER_PASS=!ROUTER_PASS!"
    echo set "ROUTER_NAME=!ROUTER_NAME!"
) > "!CONFIG_FILE!"

echo [OK] Configuration saved to !CONFIG_FILE!

:skip_configure

echo.
echo ========================================
echo Running Tests
echo ========================================
echo.

REM Start server in background
cd /d "!SCRIPT_DIR!"
start /b node server-enhanced.js > "!LOG_FILE!" 2>&1
timeout /t 3 /nobreak

echo Running endpoint tests...
node test-endpoints.js
if errorlevel 1 (
    echo [WARNING] Some tests failed, but server may still work
) else (
    echo [OK] All tests passed
)

echo.
echo ========================================
echo NetForge is Starting
echo ========================================
echo.
echo Web Interface:  http://localhost:!APP_PORT!
echo API Server:     http://localhost:!APP_PORT!
echo WebSocket:      ws://localhost:!APP_PORT!/ws
echo.
echo Router:         !ROUTER_NAME!
echo Host:           !ROUTER_HOST!:!ROUTER_PORT!
echo Username:       !ROUTER_USER!
echo.
echo Log File:       !LOG_FILE!
echo.

REM Try to open browser
echo Opening browser...
start http://localhost:!APP_PORT!

echo.
echo ========================================
echo Next Steps
echo ========================================
echo.
echo 1. Your browser should open automatically
echo.
echo 2. Login credentials:
echo    Host:     !ROUTER_HOST!
echo    Port:     !ROUTER_PORT!
echo    Username: !ROUTER_USER!
echo.
echo 3. Click 'Connect' to start monitoring
echo.
echo Features:
echo   - Real-time system monitoring
echo   - Network interface management
echo   - Firewall and routing configuration
echo   - DHCP client tracking
echo   - System logs and backups
echo   - VPN monitoring
echo.
echo View logs:
echo   type !LOG_FILE!
echo.
echo To stop the server:
echo   taskkill /F /IM node.exe
echo.
echo For more help, see SETUP.md or QUICKSTART.md
echo.
pause

REM Keep window open for logs
echo.
echo Showing server logs (close this window to stop the server):
echo.
:show_logs
timeout /t 10 >nul
if exist "!LOG_FILE!" (
    type "!LOG_FILE!"
    goto show_logs
)

endlocal
