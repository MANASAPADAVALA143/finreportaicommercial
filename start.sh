#!/bin/bash

# FinReport AI — local Docker Compose helper (your laptop with Docker Desktop).
# Railway must NOT use this as the start command. Use Dockerfile + railway.json instead.

# FinReport AI - Quick Start Script

echo "🚀 Starting FinReport AI Commercial Platform..."
echo ""

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

# Create environment files if they don't exist
if [ ! -f backend/.env ]; then
    echo "📝 Creating backend .env file..."
    cp backend/env.example backend/.env
    echo "⚠️  Please edit backend/.env with your AWS credentials and other settings"
fi

if [ ! -f frontend/.env ]; then
    echo "📝 Creating frontend .env file..."
    echo "VITE_API_URL=http://localhost:8000" > frontend/.env
fi

echo ""
echo "🐳 Starting Docker containers..."
cd infrastructure
docker-compose up -d

echo ""
echo "⏳ Waiting for services to be ready..."
sleep 10

echo ""
echo "✅ Services started successfully!"
echo ""
echo "📱 Application URLs:"
echo "   Frontend:  http://localhost:3000"
echo "   Backend:   http://localhost:8000"
echo "   API Docs:  http://localhost:8000/docs"
echo ""
echo "🔑 Default credentials (for testing):"
echo "   Create an account at http://localhost:3000/register"
echo ""
echo "📊 To view logs:"
echo "   docker-compose logs -f"
echo ""
echo "🛑 To stop all services:"
echo "   docker-compose down"
echo ""
echo "Happy analyzing! 🎉"
