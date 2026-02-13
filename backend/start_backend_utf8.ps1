# Force UTF-8 encoding for Python console output
$env:PYTHONIOENCODING = "utf-8"
$env:PYTHONUTF8 = "1"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   STARTING BACKEND WITH UTF-8 ENCODING" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

cd C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
