# Start CFO Backend Server

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   🚀 STARTING CFO BACKEND SERVER" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

cd C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend

Write-Host "[INFO] Working directory: $PWD" -ForegroundColor Yellow
Write-Host "[INFO] Starting server on port 8000..." -ForegroundColor Yellow
Write-Host "[INFO] Press CTRL+C to stop`n" -ForegroundColor Yellow

# Start without reload mode to avoid hanging
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000

Write-Host "`n[INFO] Server stopped" -ForegroundColor Red
Read-Host "Press Enter to close"
