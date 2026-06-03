@echo off
REM Set your Anthropic API key here (get from https://console.anthropic.com/settings/keys)
REM SET ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
cd /d "%~dp0"
echo Starting FinReportAI backend on port 8001...
echo Make sure ANTHROPIC_API_KEY is set in backend/.env
uvicorn app.main:app --port 8001 --reload
pause
