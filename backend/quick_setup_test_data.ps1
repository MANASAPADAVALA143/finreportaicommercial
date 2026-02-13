# Quick setup script - Generate and label test data

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   QUICK TEST DATA SETUP" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Step 1: Installing required packages..." -ForegroundColor Yellow
pip install pandas openpyxl xlrd --quiet

Write-Host "`nStep 2: Generating sample data (500 entries)..." -ForegroundColor Yellow
python generate_sample_data.py

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Error generating sample data" -ForegroundColor Red
    exit 1
}

Write-Host "`nStep 3: Labeling anomalies..." -ForegroundColor Yellow
python create_labeled_dataset.py R2R_500_Transactions_Debit_Credit_With_Anomalies.xlsx

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "   ✅ SETUP COMPLETE!" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green
    
    Write-Host "FILES CREATED:" -ForegroundColor Cyan
    Write-Host "  • R2R_500_Transactions_Debit_Credit_With_Anomalies.xlsx (original)" -ForegroundColor White
    Write-Host "  • R2R_500_Transactions_Debit_Credit_With_Anomalies_LABELED.xlsx (with ground truth)`n" -ForegroundColor White
    
    Write-Host "NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "1. Go to: http://localhost:3000/r2r" -ForegroundColor White
    Write-Host "2. Upload: R2R_500_Transactions_Debit_Credit_With_Anomalies_LABELED.xlsx" -ForegroundColor White
    Write-Host "3. Click 'Analyze with Nova AI'" -ForegroundColor White
    Write-Host "4. Check Ground Truth Validation metrics!`n" -ForegroundColor White
} else {
    Write-Host "`n❌ Error labeling data" -ForegroundColor Red
}
