@echo off
REM FinReport AI - Quick Start Script for Windows

echo 🚀 Starting FinReport AI Commercial Platform...
echo.

REM Check if Docker is installed
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not installed. Please install Docker first.
    exit /b 1
)

REM Check if Docker Compose is installed
docker-compose --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker Compose is not installed. Please install Docker Compose first.
    exit /b 1
)

REM Create environment files if they don't exist
if not exist backend\.env (
    echo 📝 Creating backend .env file...
    copy backend\env.example backend\.env
    echo ⚠️  Please edit backend\.env with your AWS credentials and other settings
)

if not exist frontend\.env (
    echo 📝 Creating frontend .env file...
    echo VITE_API_URL=http://localhost:8000 > frontend\.env
)

echo.
echo 🐳 Starting Docker containers...
cd infrastructure
docker-compose up -d

echo.
echo ⏳ Waiting for services to be ready...
timeout /t 10 /nobreak >nul

echo.
echo ✅ Services started successfully!
echo.
echo 📱 Application URLs:
echo    Frontend:  http://localhost:3000
echo    Backend:   http://localhost:8000
echo    API Docs:  http://localhost:8000/docs
echo.
echo 🔑 Default credentials (for testing):
echo    Create an account at http://localhost:3000/register
echo.
echo 📊 To view logs:
echo    docker-compose logs -f
echo.
echo 🛑 To stop all services:
echo    docker-compose down
echo.
echo Happy analyzing! 🎉
