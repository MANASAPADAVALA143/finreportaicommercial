# PowerShell script to label your dataset with ground truth

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "   📊 DATASET LABELING TOOL" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$inputFile = "R2R_500_Transactions_Debit_Credit_With_Anomalies.xlsx"

# Check if file exists
if (-not (Test-Path $inputFile)) {
    Write-Host "❌ Error: File not found: $inputFile" -ForegroundColor Red
    Write-Host "`nPlease place your Excel file in the backend directory." -ForegroundColor Yellow
    Write-Host "Or edit this script to specify the correct path.`n" -ForegroundColor Yellow
    exit 1
}

Write-Host "📁 Input file: $inputFile" -ForegroundColor White
Write-Host "🚀 Starting labeling process...`n" -ForegroundColor Green

# Run the labeling script
python create_labeled_dataset.py $inputFile

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n========================================" -ForegroundColor Green
    Write-Host "   ✅ LABELING COMPLETE!" -ForegroundColor Green
    Write-Host "========================================`n" -ForegroundColor Green
    
    $outputFile = $inputFile -replace '\.xlsx$', '_LABELED.xlsx'
    Write-Host "📄 Labeled dataset created: $outputFile" -ForegroundColor Cyan
    Write-Host "`n🎯 NEXT STEPS:" -ForegroundColor Yellow
    Write-Host "1. Go to: http://localhost:3000/r2r" -ForegroundColor White
    Write-Host "2. Upload the _LABELED.xlsx file" -ForegroundColor White
    Write-Host "3. Click 'Analyze with Nova AI'" -ForegroundColor White
    Write-Host "4. Check Ground Truth Validation metrics!`n" -ForegroundColor White
} else {
    Write-Host "`n❌ Error occurred during labeling" -ForegroundColor Red
    Write-Host "Check the error messages above`n" -ForegroundColor Red
}
