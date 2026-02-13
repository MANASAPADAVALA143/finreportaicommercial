# FinReport AI Commercial

**Enterprise Financial Intelligence Platform powered by Amazon Nova AI**

A comprehensive, production-ready financial platform offering Record-to-Report automation, FP&A suite, CFO advisory services, IFRS compliance, and AI-powered insights using Amazon Nova.

## 🚀 Features

### Core Capabilities
- **Amazon Nova AI Integration** - Advanced financial analysis and intelligent insights
- **Record to Report (R2R)** - Automated journal entry processing with fraud detection
- **FP&A Suite** - Financial planning, budgeting, and forecasting
- **CFO Services** - Strategic financial advisory and transformation
- **IFRS Compliance** - Automated regulatory compliance checking
- **Audit & Risk Management** - Real-time anomaly and fraud detection
- **ML-Powered Analytics** - Pattern recognition and predictive modeling

### Technical Features
- FastAPI backend with async support
- React + TypeScript frontend with Vite
- PostgreSQL database with SQLAlchemy ORM
- Redis caching layer
- JWT authentication
- Real-time fraud detection
- ML anomaly detection (Isolation Forest, Random Forest)
- Docker containerization
- Terraform infrastructure as code
- Nginx reverse proxy with rate limiting

## 📁 Project Structure

```
finreportai-commercial/
├── backend/                          # FastAPI backend
│   ├── app/
│   │   ├── api/
│   │   │   ├── routes/              # API endpoints
│   │   │   ├── models/              # SQLAlchemy models
│   │   │   └── schemas/             # Pydantic schemas
│   │   ├── core/
│   │   │   ├── config.py            # Configuration
│   │   │   ├── security.py          # Auth & JWT
│   │   │   └── database.py          # DB connection
│   │   ├── services/
│   │   │   ├── nova_service.py      # Amazon Nova integration
│   │   │   ├── ml_service.py        # ML models
│   │   │   └── fraud_detection.py   # Fraud detection
│   │   └── main.py                  # FastAPI app
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                         # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── landing/             # Landing page
│   │   │   ├── dashboard/           # Main dashboard
│   │   │   ├── r2r/                 # R2R module
│   │   │   └── nova/                # Nova AI assistant
│   │   ├── pages/                   # Login/Register
│   │   ├── services/
│   │   │   ├── api.ts               # API client
│   │   │   └── auth.ts              # Auth state
│   │   └── App.tsx
│   ├── package.json
│   ├── Dockerfile
│   └── nginx.conf
│
└── infrastructure/
    ├── docker-compose.yml           # Local development
    ├── nginx/                       # Reverse proxy config
    └── terraform/                   # AWS infrastructure
        └── main.tf
```

## 🛠️ Installation & Setup

### Prerequisites
- **Docker & Docker Compose** (recommended)
- **OR** Manual setup:
  - Python 3.11+
  - Node.js 18+
  - PostgreSQL 15+
  - Redis 7+

### Method 1: Docker (Recommended)

1. **Clone the repository**
```bash
git clone <repository-url>
cd finreportai-commercial
```

2. **Configure environment variables**
```bash
# Backend
cp backend/env.example backend/.env
# Edit backend/.env with your AWS credentials and other settings

# Frontend
cp frontend/.env.example frontend/.env
```

3. **Start all services**
```bash
cd infrastructure
docker-compose up -d
```

4. **Access the application**
- Frontend: http://localhost:3000
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs

### Method 2: Manual Setup

#### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp env.example .env
# Edit .env with your configuration

# Start PostgreSQL and Redis
# Then run migrations (if using Alembic)

# Start backend
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env

# Start development server
npm run dev
```

## 🔧 Configuration

### Backend Configuration (backend/.env)

```env
# Application
APP_NAME=FinReport AI Commercial
ENVIRONMENT=production
DEBUG=False

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/finreportai

# Redis
REDIS_URL=redis://localhost:6379/0

# Security
SECRET_KEY=your-super-secret-key-here
ACCESS_TOKEN_EXPIRE_MINUTES=30

# AWS & Amazon Nova
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
NOVA_MODEL_ID=amazon.nova-pro-v1:0
```

### Frontend Configuration (frontend/.env)

```env
VITE_API_URL=http://localhost:8000
```

## 🧪 API Documentation

Once the backend is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

### Key API Endpoints

#### Authentication
- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login
- `GET /api/v1/auth/me` - Get current user

#### Journal Entries
- `POST /api/v1/journal-entries/` - Create entry (with fraud detection)
- `GET /api/v1/journal-entries/` - List entries
- `PUT /api/v1/journal-entries/{id}/approve` - Approve entry

#### Analytics
- `GET /api/v1/analytics/dashboard` - Dashboard metrics
- `GET /api/v1/analytics/trends` - Trend analysis
- `GET /api/v1/analytics/financial-ratios` - Financial ratios
- `GET /api/v1/analytics/anomalies` - Flagged entries

#### Amazon Nova AI
- `POST /api/v1/nova/analyze` - AI-powered analysis
- `POST /api/v1/nova/analyze-entry` - Analyze journal entry
- `POST /api/v1/nova/forecast` - Generate forecast
- `POST /api/v1/nova/compliance-check` - IFRS compliance check

## 🤖 Amazon Nova AI Features

The platform integrates Amazon Nova for:

1. **Financial Analysis** - Natural language queries about financial data
2. **Fraud Detection** - AI-powered anomaly identification
3. **Forecasting** - Predictive financial modeling
4. **Compliance Checking** - Automated IFRS/GAAP compliance validation
5. **Strategic Insights** - CFO-level advisory recommendations

### Example Nova Queries

```python
# Python example
response = api.analyze_with_nova(
    prompt="Analyze Q4 revenue trends and provide growth recommendations",
    context={"revenue_data": historical_revenue}
)
```

```javascript
// JavaScript example
const response = await api.analyzeWithNova(
  "Check my latest journal entries for potential fraud indicators",
  { entries: recentEntries }
);
```

## 🏗️ Infrastructure Deployment

### AWS Deployment with Terraform

```bash
cd infrastructure/terraform

# Initialize Terraform
terraform init

# Configure variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars

# Plan deployment
terraform plan

# Apply infrastructure
terraform apply
```

This creates:
- VPC with public/private subnets
- RDS PostgreSQL database
- ElastiCache Redis cluster
- Security groups
- Load balancers (if configured)

### Docker Deployment

The included `docker-compose.yml` orchestrates:
- PostgreSQL database
- Redis cache
- FastAPI backend
- React frontend
- Nginx reverse proxy

## 🔒 Security Features

- **JWT Authentication** with refresh tokens
- **Password Hashing** using bcrypt
- **SQL Injection Protection** via SQLAlchemy ORM
- **CORS Configuration** for API security
- **Rate Limiting** via Nginx
- **Security Headers** (X-Frame-Options, CSP, etc.)
- **Fraud Detection** with ML algorithms
- **Audit Logging** for compliance

## 📊 Fraud Detection Algorithm

The platform uses multi-layered fraud detection:

1. **Rule-Based Detection**
   - Round amount detection
   - Threshold manipulation
   - High-risk account types
   - Timing anomalies (weekends, off-hours)

2. **ML-Based Detection**
   - Isolation Forest for anomaly detection
   - Pattern recognition across transactions
   - Duplicate detection
   - Amount splitting identification

3. **Risk Scoring**
   - Combined fraud score (0-1 scale)
   - Risk levels: Low, Medium, High
   - Automatic flagging for review

## 🧪 Testing

### Backend Tests
```bash
cd backend
pytest
pytest --cov=app tests/
```

### Frontend Tests
```bash
cd frontend
npm test
npm run test:coverage
```

## 📈 Performance Optimization

- **Database Indexing** on frequently queried fields
- **Redis Caching** for analytics queries
- **Connection Pooling** for PostgreSQL
- **Async Operations** in FastAPI
- **Code Splitting** in React
- **Gzip Compression** via Nginx
- **CDN Integration** ready

## 🔄 Development Workflow

1. **Branch Strategy**: GitFlow (main, develop, feature/*, hotfix/*)
2. **Code Review**: Required before merging
3. **CI/CD**: GitHub Actions / GitLab CI (configure as needed)
4. **Database Migrations**: Alembic (backend/alembic/)
5. **Linting**: ESLint (frontend), Flake8/Black (backend)

## 📝 Environment Variables Reference

### Required Backend Variables
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `SECRET_KEY` - JWT signing key
- `AWS_ACCESS_KEY_ID` - AWS credentials
- `AWS_SECRET_ACCESS_KEY` - AWS credentials

### Optional Backend Variables
- `ENVIRONMENT` - deployment environment
- `DEBUG` - debug mode (default: False)
- `NOVA_MODEL_ID` - Amazon Nova model
- `FRAUD_THRESHOLD_HIGH` - fraud detection threshold

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is proprietary software. All rights reserved.

## 🆘 Support & Documentation

- **API Documentation**: http://localhost:8000/docs
- **Issues**: GitHub Issues
- **Email**: support@finreportai.com

## 🎯 Roadmap

- [ ] Multi-currency support
- [ ] Advanced forecasting models
- [ ] Mobile applications
- [ ] Excel/CSV bulk import
- [ ] Custom report builder
- [ ] Integration marketplace
- [ ] Blockchain audit trail
- [ ] Advanced ML models

## 🏆 Credits

Built with:
- FastAPI
- React
- Amazon Nova AI (AWS Bedrock)
- PostgreSQL
- Redis
- Docker
- Terraform

---

**FinReport AI Commercial** - Transforming Finance with Artificial Intelligence

For enterprise inquiries: enterprise@finreportai.com
