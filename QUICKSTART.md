# Quick Start Guide

## Prerequisites
- Docker & Docker Compose installed
- AWS account with Bedrock access (for Amazon Nova)
- 8GB+ RAM recommended

## Installation (5 minutes)

### 1. Clone & Configure

```bash
# Clone the repository
git clone <repository-url>
cd finreportai-commercial

# Copy environment files
cp backend/env.example backend/.env
cp frontend/.env.example frontend/.env
```

### 2. Configure AWS Credentials

Edit `backend/.env`:
```env
AWS_ACCESS_KEY_ID=your-access-key-here
AWS_SECRET_ACCESS_KEY=your-secret-key-here
AWS_REGION=us-east-1
```

### 3. Start the Application

**Linux/Mac:**
```bash
chmod +x start.sh
./start.sh
```

**Windows:**
```cmd
start.bat
```

**Or manually:**
```bash
cd infrastructure
docker-compose up -d
```

### 4. Access the Application

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Documentation**: http://localhost:8000/docs

## First Steps

1. **Create Account**
   - Go to http://localhost:3000/register
   - Fill in your details
   - Login with your credentials

2. **Explore Dashboard**
   - View financial overview
   - Access different modules

3. **Create Journal Entry**
   - Go to R2R Module
   - Click "New Entry"
   - Fill in details
   - Watch fraud detection in action!

4. **Try Nova AI**
   - Go to Nova Assistant
   - Ask: "Analyze my recent journal entries"
   - Get AI-powered insights

## Common Issues

### Port Already in Use
```bash
# Change ports in docker-compose.yml
ports:
  - "3001:3000"  # Instead of 3000:3000
  - "8001:8000"  # Instead of 8000:8000
```

### Database Connection Error
```bash
# Reset database
docker-compose down -v
docker-compose up -d
```

### AWS/Nova Not Working
- Ensure AWS credentials are correct
- Check AWS Bedrock is enabled in your region
- Verify Nova model access permissions

## Development Mode

### Backend Development
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend Development
```bash
cd frontend
npm install
npm run dev
```

## Stopping the Application

```bash
cd infrastructure
docker-compose down
```

To remove all data:
```bash
docker-compose down -v
```

## Next Steps

- Read the full README.md
- Explore API documentation at /docs
- Configure production settings
- Set up Terraform for AWS deployment

## Support

- Documentation: README.md
- API Docs: http://localhost:8000/docs
- Issues: GitHub Issues
