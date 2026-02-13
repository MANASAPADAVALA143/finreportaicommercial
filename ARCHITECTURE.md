# FinReport AI - Architecture Overview

## System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT TIER                              │
├─────────────────────────────────────────────────────────────────┤
│  React Frontend (Vite + TypeScript)                             │
│  - Landing Page                                                  │
│  - Dashboard                                                     │
│  - R2R Module                                                    │
│  - FP&A Suite                                                    │
│  - CFO Services                                                  │
│  - IFRS Compliance                                              │
│  - Nova AI Assistant                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS/REST
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      LOAD BALANCER / CDN                         │
│                     (Nginx / AWS CloudFront)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    APPLICATION TIER                              │
├─────────────────────────────────────────────────────────────────┤
│  FastAPI Backend (Python 3.11)                                  │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  API Routes                                                 │ │
│  │  - Authentication (JWT)                                     │ │
│  │  - Journal Entries                                          │ │
│  │  - Analytics                                                │ │
│  │  - Amazon Nova AI                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │  Business Services                                          │ │
│  │  - Fraud Detection Service                                  │ │
│  │  - ML Service (Isolation Forest, Random Forest)             │ │
│  │  - Nova Service (AWS Bedrock Integration)                   │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         │                    │                    │
         ▼                    ▼                    ▼
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│   PostgreSQL   │  │     Redis      │  │  AWS Bedrock   │
│   Database     │  │     Cache      │  │  (Nova AI)     │
│   - Users      │  │  - Sessions    │  │  - Analysis    │
│   - Entries    │  │  - Analytics   │  │  - Forecasts   │
│   - Reports    │  │                │  │  - Compliance  │
│   - Audit Logs │  │                │  │                │
└────────────────┘  └────────────────┘  └────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      INFRASTRUCTURE                              │
├─────────────────────────────────────────────────────────────────┤
│  Docker Containers                                              │
│  - Backend API (8000)                                           │
│  - Frontend (3000)                                              │
│  - PostgreSQL (5432)                                            │
│  - Redis (6379)                                                 │
│  - Nginx (80/443)                                               │
│                                                                  │
│  AWS Resources (Terraform)                                      │
│  - VPC with Public/Private Subnets                             │
│  - RDS PostgreSQL                                               │
│  - ElastiCache Redis                                           │
│  - Bedrock (Nova AI)                                           │
│  - CloudWatch Logs                                              │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. User Authentication Flow
```
User → Frontend → POST /api/v1/auth/login
                    ↓
              Verify Credentials
                    ↓
              Generate JWT Token
                    ↓
              Return Access Token
                    ↓
           Store in LocalStorage
```

### 2. Journal Entry Creation with Fraud Detection
```
User → Create Entry → POST /api/v1/journal-entries/
                           ↓
                    Validate Input
                           ↓
                    ┌──────┴──────┐
                    │             │
          Fraud Detection    ML Anomaly
           (Rule-Based)       Detection
                    │             │
                    └──────┬──────┘
                           ↓
                  Calculate Risk Score
                           ↓
                    Save to Database
                           ↓
                  Return Entry + Score
```

### 3. Amazon Nova AI Analysis Flow
```
User Query → POST /api/v1/nova/analyze
                    ↓
          Prepare Enhanced Prompt
                    ↓
          Add Financial Context
                    ↓
    AWS Bedrock API (Nova Model)
                    ↓
         Parse AI Response
                    ↓
    Return Insights + Confidence
```

## Security Architecture

```
┌─────────────────────────────────────────────┐
│         Security Layers                     │
├─────────────────────────────────────────────┤
│ 1. Network Layer                            │
│    - HTTPS/TLS                             │
│    - Rate Limiting                          │
│    - CORS Policy                            │
│                                             │
│ 2. Application Layer                        │
│    - JWT Authentication                     │
│    - Password Hashing (bcrypt)              │
│    - Input Validation                       │
│    - SQL Injection Prevention               │
│                                             │
│ 3. Data Layer                               │
│    - Encrypted Storage                      │
│    - Audit Logging                          │
│    - Access Control                         │
│                                             │
│ 4. Fraud Detection                          │
│    - Real-time Monitoring                   │
│    - ML Anomaly Detection                   │
│    - Pattern Analysis                       │
└─────────────────────────────────────────────┘
```

## Technology Stack

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand
- **HTTP Client**: Axios
- **Charts**: Recharts
- **Icons**: Lucide React

### Backend
- **Framework**: FastAPI (Python 3.11)
- **ORM**: SQLAlchemy
- **Migrations**: Alembic
- **Authentication**: JWT (python-jose)
- **Password Hashing**: bcrypt
- **Validation**: Pydantic

### ML & AI
- **Amazon Nova**: AWS Bedrock
- **Anomaly Detection**: Isolation Forest
- **Classification**: Random Forest
- **Data Processing**: Pandas, NumPy
- **ML Framework**: Scikit-learn

### Database & Cache
- **Primary DB**: PostgreSQL 15
- **Cache**: Redis 7
- **Connection Pooling**: SQLAlchemy

### Infrastructure
- **Containerization**: Docker
- **Orchestration**: Docker Compose
- **IaC**: Terraform
- **Web Server**: Nginx
- **Cloud**: AWS (VPC, RDS, ElastiCache, Bedrock)

### DevOps
- **CI/CD**: GitHub Actions
- **Monitoring**: CloudWatch, Prometheus
- **Logging**: JSON Logger
- **Version Control**: Git

## Scalability Considerations

1. **Horizontal Scaling**
   - Stateless API design
   - Load balancer distribution
   - Multiple backend instances

2. **Caching Strategy**
   - Redis for session data
   - Analytics query caching
   - API response caching

3. **Database Optimization**
   - Indexed queries
   - Connection pooling
   - Read replicas (future)

4. **Async Processing**
   - Background jobs (future)
   - Message queue (future)
   - Celery tasks (future)

## Deployment Environments

### Development
- Local Docker Compose
- Hot reload enabled
- Debug logging
- Mock AWS services

### Staging
- AWS ECS/Fargate
- RDS (small instance)
- CloudWatch monitoring
- Limited Nova calls

### Production
- AWS ECS/Fargate (multi-AZ)
- RDS (highly available)
- ElastiCache cluster
- Full monitoring suite
- Auto-scaling enabled
