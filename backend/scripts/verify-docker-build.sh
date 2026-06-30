#!/usr/bin/env bash
# Verify Docker image builds — run on Linux/EC2 or with Docker Desktop started on Windows.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Building finreportai-backend..."
docker build -t finreportai-backend:latest .
echo "Starting health check..."
docker run --rm -d --name finreportai-test -p 18000:8000 \
  -e DATABASE_URL=sqlite:///./test.db \
  -e DEBUG=False \
  finreportai-backend:latest
sleep 15
curl -fsS http://127.0.0.1:18000/health && echo ""
docker stop finreportai-test
echo "OK — Docker build and /health passed"
