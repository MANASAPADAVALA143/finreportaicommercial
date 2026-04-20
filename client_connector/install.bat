@echo off
setlocal
cd /d "%~dp0"
echo FinReportAI Tally Connector Installation
echo =========================================
echo.

python --version >nul 2>&1
if errorlevel 1 (
    echo Python not found. Install Python 3.11+ from python.org or:
    echo   winget install Python.Python.3.11
    pause
    exit /b 1
)

echo Installing dependencies...
pip install requests -q

echo.
echo Starting setup wizard...
python tally_connector.py --setup

echo.
echo Installation complete!
pause
