# Start PostgreSQL on Windows: Windows service, Docker, or pg_ctl hint.
$ErrorActionPreference = "Continue"

Write-Host "=== CFO: starting PostgreSQL ===" -ForegroundColor Cyan

$started = $false

$pgServices = Get-Service -ErrorAction SilentlyContinue | Where-Object {
    $_.Name -match "postgres|postgresql" -or $_.DisplayName -match "postgres|postgresql"
}
foreach ($svc in $pgServices) {
    Write-Host "Service: $($svc.Name) ($($svc.DisplayName)) -> $($svc.Status)"
    if ($svc.Status -ne "Running") {
        try {
            Start-Service -Name $svc.Name -ErrorAction Stop
            Write-Host "Started Windows service: $($svc.Name)" -ForegroundColor Green
            $started = $true
        } catch {
            Write-Host "Could not start $($svc.Name): $_" -ForegroundColor Yellow
            Write-Host "  Try: Run PowerShell as Administrator, then: Start-Service $($svc.Name)"
        }
    } else {
        Write-Host "Already running: $($svc.Name)" -ForegroundColor Green
        $started = $true
    }
}

if (-not $started -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    $backendRoot = Split-Path -Parent $PSScriptRoot
    $repoRoot = Split-Path -Parent $backendRoot
    $composeInfra = Join-Path $repoRoot "infrastructure\docker-compose.yml"
    $composeLocal = Join-Path $backendRoot "docker-compose.postgres.yml"
    if (Test-Path $composeInfra) {
        Write-Host "Starting postgres via infrastructure/docker-compose.yml ..." -ForegroundColor Cyan
        docker compose -f $composeInfra up -d postgres
        if ($LASTEXITCODE -eq 0) { $started = $true }
    }
    if (-not $started -and (Test-Path $composeLocal)) {
        Write-Host "Starting postgres via backend/docker-compose.postgres.yml ..." -ForegroundColor Cyan
        Set-Location $backendRoot
        docker compose -f docker-compose.postgres.yml up -d
        if ($LASTEXITCODE -eq 0) { $started = $true }
    }
}

if (-not $started) {
    Write-Host ""
    Write-Host "No PostgreSQL service started automatically." -ForegroundColor Yellow
    Write-Host "Install PostgreSQL for Windows, or Docker Desktop, then:"
    Write-Host "  winget install PostgreSQL.PostgreSQL --accept-package-agreements"
    Write-Host "  OR: docker compose -f infrastructure/docker-compose.yml up -d postgres"
    exit 1
}

Write-Host "Done." -ForegroundColor Green
exit 0
