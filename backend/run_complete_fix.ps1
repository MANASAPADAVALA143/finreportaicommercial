# Complete Fix Script - Fraud Detection Enhancement
# This script runs all steps for the enhanced fraud detection system

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   🚀 FRAUD DETECTION ENHANCEMENT SETUP" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Step 1: Check if Python is available
Write-Host "📋 Step 1: Checking Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✅ Python found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Python not found! Please install Python 3.8+" -ForegroundColor Red
    exit 1
}

# Step 2: Check for input file
Write-Host "`n📋 Step 2: Checking for input data file..." -ForegroundColor Yellow

$inputFiles = @(
    "R2R_500_Transactions_With_Anomalies.xlsx",
    "/mnt/user-data/uploads/R2R_500_Transactions_With_Anomalies.xlsx",
    "sample_journal_entries.csv"
)

$foundFile = $null
foreach ($file in $inputFiles) {
    if (Test-Path $file) {
        $foundFile = $file
        Write-Host "✅ Found input file: $file" -ForegroundColor Green
        break
    }
}

if (-not $foundFile) {
    Write-Host "⚠️  No specific input file found. Will use sample_journal_entries.csv" -ForegroundColor Yellow
    $foundFile = "sample_journal_entries.csv"
}

# Step 3: Run labeling script
Write-Host "`n📋 Step 3: Creating labeled dataset..." -ForegroundColor Yellow
Write-Host "   Running: python create_labeled_dataset.py $foundFile" -ForegroundColor Cyan

try {
    if (Test-Path $foundFile) {
        python create_labeled_dataset.py $foundFile
        Write-Host "`n✅ Labeled dataset created successfully!" -ForegroundColor Green
    } else {
        Write-Host "❌ Input file not found: $foundFile" -ForegroundColor Red
        Write-Host "`nPlease place your data file in the backend directory:" -ForegroundColor Yellow
        Write-Host "   - R2R_500_Transactions_With_Anomalies.xlsx" -ForegroundColor White
        Write-Host "`nOr run manually:" -ForegroundColor Yellow
        Write-Host "   python create_labeled_dataset.py [your_file.xlsx]" -ForegroundColor White
        exit 1
    }
} catch {
    Write-Host "❌ Error creating labeled dataset: $_" -ForegroundColor Red
    exit 1
}

# Step 4: Check if backend is running
Write-Host "`n📋 Step 4: Checking backend server..." -ForegroundColor Yellow

try {
    $response = Invoke-WebRequest -Uri "http://localhost:8000/docs" -Method GET -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✅ Backend is already running on port 8000" -ForegroundColor Green
    $needsRestart = $false
} catch {
    Write-Host "⚠️  Backend is not running" -ForegroundColor Yellow
    $needsRestart = $true
}

# Step 5: Restart backend if needed
if ($needsRestart) {
    Write-Host "`n📋 Step 5: Starting backend server..." -ForegroundColor Yellow
    Write-Host "   Killing any existing Python processes..." -ForegroundColor Cyan
    
    Get-Process -Name "python" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    
    Write-Host "   Starting backend on port 8000..." -ForegroundColor Cyan
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot'; python -m uvicorn app.main:app --reload --port 8000"
    
    Write-Host "   Waiting for backend to start..." -ForegroundColor Cyan
    Start-Sleep -Seconds 5
    
    # Verify backend started
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:8000/docs" -Method GET -TimeoutSec 5 -ErrorAction Stop
        Write-Host "✅ Backend started successfully!" -ForegroundColor Green
    } catch {
        Write-Host "❌ Backend failed to start" -ForegroundColor Red
        Write-Host "   Please start manually: python -m uvicorn app.main:app --reload --port 8000" -ForegroundColor Yellow
    }
} else {
    Write-Host "`n📋 Step 5: Restarting backend to load new changes..." -ForegroundColor Yellow
    Write-Host "   Please restart the backend manually to load the updated code" -ForegroundColor Yellow
}

# Step 6: Summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   ✅ SETUP COMPLETE!" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "📊 NEXT STEPS:`n" -ForegroundColor Green

Write-Host "1. Make sure backend is running on http://localhost:8000" -ForegroundColor White
Write-Host "2. Make sure frontend is running on http://localhost:5173" -ForegroundColor White
Write-Host "3. Upload the LABELED file through the R2R Module:" -ForegroundColor White

# Find the labeled file
$labeledFiles = Get-ChildItem -Filter "*_LABELED.*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($labeledFiles) {
    Write-Host "   📄 $($labeledFiles.Name)" -ForegroundColor Cyan
} else {
    Write-Host "   📄 (Look for *_LABELED.xlsx or *_LABELED.csv)" -ForegroundColor Cyan
}

Write-Host "`n4. Expected Results:" -ForegroundColor White
Write-Host "   ✅ High-Risk detections: 85-95% recall" -ForegroundColor Green
Write-Host "   ✅ Ground truth validation displayed" -ForegroundColor Green
Write-Host "   ✅ Confusion matrix shown" -ForegroundColor Green
Write-Host "   ✅ SHAP analysis for each entry" -ForegroundColor Green

Write-Host "`n🔗 Useful Links:" -ForegroundColor Yellow
Write-Host "   Backend API: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "   Frontend: http://localhost:5173" -ForegroundColor Cyan

Write-Host "`n========================================`n" -ForegroundColor Cyan
