#!/usr/bin/env bash
# FinReportAI EC2 bootstrap — Ubuntu 22.04
# Run on EC2 after: ssh -i gnanova-key.pem ubuntu@YOUR_EC2_PUBLIC_IP
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/MANASAPADAVALA143/finreportaicommercial.git}"
APP_DIR="${APP_DIR:-/home/ubuntu/finreportaicommercial}"

echo "==> System packages"
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-pip python3-venv nginx git postgresql-client

echo "==> Clone repo"
if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR/backend"

echo "==> Python venv"
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
pip install gunicorn

if [ ! -f .env ]; then
  echo "!! Copy deploy/ec2/env.production.example to backend/.env and fill secrets, then re-run:"
  echo "   cp $APP_DIR/deploy/ec2/env.production.example $APP_DIR/backend/.env && nano $APP_DIR/backend/.env"
  exit 1
fi

echo "==> Alembic migrations"
alembic upgrade head

echo "==> systemd"
sudo cp "$APP_DIR/deploy/ec2/finreportai.service" /etc/systemd/system/finreportai.service
sudo systemctl daemon-reload
sudo systemctl enable finreportai
sudo systemctl restart finreportai

echo "==> Nginx"
sudo cp "$APP_DIR/deploy/ec2/nginx-finreportai.conf" /etc/nginx/sites-available/finreportai
sudo ln -sf /etc/nginx/sites-available/finreportai /etc/nginx/sites-enabled/finreportai
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "==> Health check"
sleep 2
curl -sf "http://127.0.0.1:8000/health" && echo "" || echo "WARN: /health failed — check: sudo journalctl -u finreportai -n 50"

echo "Done. Set Vercel VITE_API_URL=http://YOUR_EC2_PUBLIC_IP"
