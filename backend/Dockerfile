# syntax=docker/dockerfile:1
# Build: cd backend && docker build -t finreportai-backend .
# Run:   docker compose up -d

FROM python:3.11-slim AS builder

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_PREFER_BINARY=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --upgrade pip wheel setuptools

COPY requirements.txt .

# Pre-install heavy numeric stack as wheels only (avoids OOM compile on small EC2)
RUN pip install --only-binary=:all: \
    "numpy==1.26.4" \
    "scipy==1.11.4" \
    "pandas==2.2.2" \
    "scikit-learn==1.4.2" \
    "xgboost==2.0.3" \
    "lxml>=5.2.0,<6" \
    "pillow>=10.0.0,<11"

RUN pip install --prefer-binary -r requirements.txt

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONPATH=/app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    poppler-utils \
    tesseract-ocr \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app

COPY app ./app
COPY excel_addin ./excel_addin
COPY alembic ./alembic
COPY alembic.ini ./

RUN useradd -m -u 1000 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT:-8000}/health" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
