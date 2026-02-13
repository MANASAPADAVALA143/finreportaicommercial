# 🚀 Deployment Guide - FinReport AI Commercial

Complete guide for deploying to various environments.

---

## 📋 Table of Contents
1. [Local Development](#local-development)
2. [Docker Production](#docker-production)
3. [AWS Deployment](#aws-deployment)
4. [Environment Variables](#environment-variables)
5. [Database Setup](#database-setup)
6. [Monitoring & Logging](#monitoring--logging)
7. [Troubleshooting](#troubleshooting)

---

## 🖥️ Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- AWS Account (for Nova AI)

### Backend Setup

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Linux/Mac:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp env.example .env
# Edit .env with your configuration

# Run database migrations
alembic upgrade head

# Start development server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Backend will be available at: http://localhost:8000

### Frontend Setup

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Create .env file
echo "VITE_API_URL=http://localhost:8000" > .env

# Start development server
npm run dev
```

Frontend will be available at: http://localhost:3000

---

## 🐳 Docker Production

### Quick Start

```bash
# Using provided scripts
./start.sh          # Linux/Mac
start.bat           # Windows

# Or manually
cd infrastructure
docker-compose up -d
```

### Custom Docker Deployment

```bash
# Build images
docker-compose build

# Start services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Remove all data (warning: destroys database)
docker-compose down -v
```

### Verify Services

```bash
# Check running containers
docker-compose ps

# Expected output:
# NAME                    STATUS              PORTS
# finreport_postgres      Up (healthy)        5432
# finreport_redis         Up (healthy)        6379
# finreport_backend       Up                  8000
# finreport_frontend      Up                  80
# finreport_nginx         Up                  80, 443
```

### Access Services
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- PostgreSQL: localhost:5432
- Redis: localhost:6379

---

## ☁️ AWS Deployment

### Prerequisites
- AWS Account
- AWS CLI configured
- Terraform installed
- AWS Bedrock access enabled

### Step 1: Configure AWS Credentials

```bash
# Configure AWS CLI
aws configure
# Enter:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region (e.g., us-east-1)
# - Default output format (json)
```

### Step 2: Prepare Terraform

```bash
cd infrastructure/terraform

# Copy example variables
cp terraform.tfvars.example terraform.tfvars

# Edit terraform.tfvars
nano terraform.tfvars
```

**terraform.tfvars:**
```hcl
aws_region  = "us-east-1"
environment = "production"
app_name    = "finreportai"
db_password = "YOUR-SECURE-PASSWORD-HERE"
```

### Step 3: Deploy Infrastructure

```bash
# Initialize Terraform
terraform init

# Preview changes
terraform plan

# Apply infrastructure
terraform apply

# Note down outputs:
# - VPC ID
# - RDS endpoint
# - Redis endpoint
```

### Step 4: Deploy Application

#### Option A: ECS Fargate (Recommended)

```bash
# Build and push Docker images to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ECR_REGISTRY

# Tag images
docker tag finreportai-backend:latest YOUR_ECR_REGISTRY/finreportai-backend:latest
docker tag finreportai-frontend:latest YOUR_ECR_REGISTRY/finreportai-frontend:latest

# Push images
docker push YOUR_ECR_REGISTRY/finreportai-backend:latest
docker push YOUR_ECR_REGISTRY/finreportai-frontend:latest

# Deploy to ECS (create task definitions and services via AWS Console or CLI)
```

#### Option B: EC2 with Docker Compose

```bash
# SSH into EC2 instance
ssh -i your-key.pem ec2-user@YOUR_EC2_IP

# Install Docker
sudo yum update -y
sudo yum install docker -y
sudo systemctl start docker
sudo usermod -aG docker ec2-user

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Clone repository
git clone YOUR_REPO_URL
cd finreportai-commercial

# Configure environment
cp backend/env.example backend/.env
nano backend/.env  # Update with RDS and Redis endpoints

# Start services
cd infrastructure
docker-compose up -d
```

### Step 5: Configure DNS

```bash
# Point your domain to the load balancer or EC2 IP
# Example with Route 53:
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch file://dns-change.json
```

### Step 6: Enable SSL/TLS

```bash
# Option 1: AWS Certificate Manager (recommended)
# - Request certificate in AWS Console
# - Add to Application Load Balancer

# Option 2: Let's Encrypt with Certbot
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

---

## 🔐 Environment Variables

### Backend (.env)

**Required:**
```env
# Application
APP_NAME=FinReport AI Commercial
ENVIRONMENT=production
DEBUG=False

# Database
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Redis
REDIS_URL=redis://host:6379/0

# Security (CHANGE THESE!)
SECRET_KEY=your-super-secret-key-min-32-chars
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=30

# AWS & Nova
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
NOVA_MODEL_ID=amazon.nova-pro-v1:0
```

**Optional:**
```env
# CORS
BACKEND_CORS_ORIGINS=["https://yourdomain.com"]

# Rate Limiting
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_PERIOD=60

# Fraud Detection
FRAUD_THRESHOLD_HIGH=0.8
FRAUD_THRESHOLD_MEDIUM=0.5
```

### Frontend (.env)

```env
VITE_API_URL=https://api.yourdomain.com
```

---

## 💾 Database Setup

### Create Database

```bash
# Connect to PostgreSQL
psql -h your-db-host -U postgres

# Create database
CREATE DATABASE finreportai;

# Create user (if needed)
CREATE USER finreportai_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE finreportai TO finreportai_user;
```

### Run Migrations

```bash
cd backend

# Check migration status
alembic current

# Run all migrations
alembic upgrade head

# Rollback (if needed)
alembic downgrade -1
```

### Seed Data (Optional)

```python
# Create a seed script: backend/seed.py
from app.core.database import SessionLocal
from app.api.models import User
from app.core.security import get_password_hash

db = SessionLocal()

# Create admin user
admin = User(
    email="admin@example.com",
    hashed_password=get_password_hash("admin123"),
    full_name="Admin User",
    role="admin",
    is_active=True
)

db.add(admin)
db.commit()
print("Admin user created!")
```

```bash
# Run seed script
python seed.py
```

---

## 📊 Monitoring & Logging

### Application Logs

```bash
# Docker logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Specific service
docker-compose logs -f --tail=100 backend
```

### AWS CloudWatch

```bash
# View logs
aws logs tail /aws/ecs/finreportai-backend --follow

# Create custom metrics
aws cloudwatch put-metric-data \
  --namespace FinReportAI \
  --metric-name RequestCount \
  --value 1
```

### Health Checks

```bash
# Backend health
curl http://localhost:8000/health

# Expected response:
# {"status":"healthy","timestamp":1234567890}

# Database connection test
curl http://localhost:8000/api/v1/auth/me \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## 🔍 Troubleshooting

### Issue: Backend won't start

**Solution:**
```bash
# Check logs
docker-compose logs backend

# Common fixes:
# 1. Database not ready
docker-compose restart postgres
docker-compose restart backend

# 2. Port already in use
# Change port in docker-compose.yml
ports:
  - "8001:8000"  # Instead of 8000:8000
```

### Issue: Frontend can't connect to backend

**Solution:**
```bash
# 1. Check CORS settings in backend/.env
BACKEND_CORS_ORIGINS=["http://localhost:3000"]

# 2. Verify API URL in frontend/.env
VITE_API_URL=http://localhost:8000

# 3. Restart both services
docker-compose restart backend frontend
```

### Issue: Database connection failed

**Solution:**
```bash
# 1. Verify database is running
docker-compose ps postgres

# 2. Check connection string
# Format: postgresql://user:password@host:port/database
DATABASE_URL=postgresql://postgres:postgres@postgres:5432/finreportai

# 3. Test connection
docker-compose exec postgres psql -U postgres -d finreportai -c "SELECT 1;"
```

### Issue: Nova AI not working

**Solution:**
```bash
# 1. Verify AWS credentials
aws sts get-caller-identity

# 2. Check Bedrock access
aws bedrock list-foundation-models --region us-east-1

# 3. Verify model ID in .env
NOVA_MODEL_ID=amazon.nova-pro-v1:0

# 4. Check IAM permissions for Bedrock
```

### Issue: Redis connection failed

**Solution:**
```bash
# 1. Check Redis is running
docker-compose ps redis

# 2. Test connection
docker-compose exec redis redis-cli ping
# Should return: PONG

# 3. Verify Redis URL
REDIS_URL=redis://redis:6379/0
```

---

## 🔄 Updates & Maintenance

### Update Application

```bash
# Pull latest changes
git pull origin main

# Rebuild containers
docker-compose build

# Restart services
docker-compose down
docker-compose up -d

# Run new migrations
docker-compose exec backend alembic upgrade head
```

### Backup Database

```bash
# Create backup
docker-compose exec postgres pg_dump -U postgres finreportai > backup_$(date +%Y%m%d).sql

# Restore backup
docker-compose exec -T postgres psql -U postgres finreportai < backup_20240115.sql
```

### Scale Services (Docker Swarm or K8s)

```bash
# Docker Swarm
docker service scale finreportai_backend=3

# Kubernetes
kubectl scale deployment finreportai-backend --replicas=3
```

---

## 📈 Performance Optimization

### Database
- Enable connection pooling (already configured)
- Add indexes on frequently queried fields
- Use read replicas for analytics queries

### Caching
- Redis caching for dashboard analytics (implemented)
- CDN for static assets (configure CloudFront)
- API response caching for heavy queries

### Application
- Enable Gunicorn workers: `gunicorn app.main:app -w 4 -k uvicorn.workers.UvicornWorker`
- Use async operations (already implemented)
- Implement rate limiting (configured in Nginx)

---

## 🔒 Security Checklist

- [ ] Change default SECRET_KEY
- [ ] Use strong database passwords
- [ ] Enable SSL/TLS certificates
- [ ] Configure firewall rules
- [ ] Enable AWS WAF (if using AWS)
- [ ] Set up regular backups
- [ ] Enable audit logging
- [ ] Rotate AWS credentials regularly
- [ ] Use AWS Secrets Manager for sensitive data
- [ ] Enable MFA for AWS account
- [ ] Regular security updates
- [ ] Monitor for suspicious activity

---

## 📞 Support

If you encounter issues:
1. Check logs: `docker-compose logs`
2. Review this guide
3. Check GitHub Issues
4. Contact support: support@finreportai.com

---

## ✅ Deployment Checklist

### Pre-Deployment
- [ ] All environment variables configured
- [ ] AWS credentials set up
- [ ] Database created and migrated
- [ ] Redis configured
- [ ] SSL certificates ready
- [ ] Domain DNS configured
- [ ] Backup strategy in place

### Post-Deployment
- [ ] Health checks passing
- [ ] Can create user account
- [ ] Can login successfully
- [ ] Nova AI responding
- [ ] Fraud detection working
- [ ] Analytics loading
- [ ] Monitoring set up
- [ ] Logs accessible

---

**🎉 Congratulations! Your FinReport AI Commercial platform is now deployed!**

For production use, consider:
- Load balancing (AWS ALB/ELB)
- Auto-scaling (AWS ECS/Auto Scaling Groups)
- CDN (CloudFront)
- Monitoring (CloudWatch, Prometheus, Grafana)
- Error tracking (Sentry)
- Log aggregation (ELK Stack)
