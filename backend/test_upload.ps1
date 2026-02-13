# Test Script - Upload Labeled Dataset to Backend

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   📊 TESTING FRAUD DETECTION SYSTEM" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Check if backend is running
Write-Host "[1/4] Checking backend status..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8000/health" -TimeoutSec 3
    Write-Host "✅ Backend is healthy: $($health.status)`n" -ForegroundColor Green
} catch {
    Write-Host "❌ Backend is not running on port 8000" -ForegroundColor Red
    Write-Host "Please start it with: python -m uvicorn app.main:app --port 8000`n" -ForegroundColor Yellow
    exit 1
}

# Check if labeled file exists
Write-Host "[2/4] Checking for labeled dataset..." -ForegroundColor Yellow
$labeledFile = "sample_journal_entries_LABELED.csv"
if (Test-Path $labeledFile) {
    Write-Host "✅ Found: $labeledFile`n" -ForegroundColor Green
} else {
    Write-Host "❌ File not found: $labeledFile" -ForegroundColor Red
    Write-Host "Please run: python create_labeled_dataset.py sample_journal_entries.csv`n" -ForegroundColor Yellow
    exit 1
}

# Read file stats
$csv = Import-Csv $labeledFile
$totalEntries = $csv.Count
$anomalies = ($csv | Where-Object { $_.Is_Anomaly -eq "1" }).Count

Write-Host "[3/4] Dataset statistics:" -ForegroundColor Yellow
Write-Host "   Total entries: $totalEntries" -ForegroundColor White
Write-Host "   Labeled anomalies: $anomalies" -ForegroundColor White
Write-Host "   Anomaly rate: $([math]::Round(($anomalies / $totalEntries) * 100, 1))%`n" -ForegroundColor White

# Upload to backend (simulate - requires auth token)
Write-Host "[4/4] Upload instructions:" -ForegroundColor Yellow
Write-Host "   ✅ Backend is ready at: http://localhost:8000" -ForegroundColor Green
Write-Host "   ✅ Labeled file ready: $labeledFile" -ForegroundColor Green
Write-Host "   ✅ API docs available at: http://localhost:8000/docs" -ForegroundColor Green
Write-Host "`n📋 NEXT STEPS:" -ForegroundColor Cyan
Write-Host "   1. Open frontend: http://localhost:5173" -ForegroundColor White
Write-Host "   2. Navigate to: R2R Module" -ForegroundColor White
Write-Host "   3. Upload file: backend\$labeledFile" -ForegroundColor White
Write-Host "   4. View results with ground truth validation!`n" -ForegroundColor White

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   ✅ SYSTEM READY FOR TESTING!" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan
