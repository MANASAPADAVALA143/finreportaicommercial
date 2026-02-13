from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime


# Auth Schemas
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = None
    company: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: Optional[str]
    company: Optional[str]
    role: str
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# Journal Entry Schemas
class JournalEntryCreate(BaseModel):
    entry_date: datetime
    description: str
    account: str
    debit: float = 0.0
    credit: float = 0.0
    reference: Optional[str] = None


class JournalEntryResponse(BaseModel):
    id: int
    entry_date: datetime
    description: str
    account: str
    debit: float
    credit: float
    reference: Optional[str]
    status: str
    fraud_score: Optional[float]
    anomaly_detected: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# Analytics Schemas
class AnalyticsQuery(BaseModel):
    query: str
    filters: Optional[dict] = None


class AnalyticsResponse(BaseModel):
    result: dict
    insights: List[str]
    visualizations: Optional[List[dict]] = None


# Nova Request/Response
class NovaPrompt(BaseModel):
    prompt: str
    context: Optional[dict] = None
    max_tokens: Optional[int] = None
    temperature: Optional[float] = None


class NovaResponse(BaseModel):
    response: str
    confidence: float
    metadata: Optional[dict] = None


# Report Schemas
class ReportGenerate(BaseModel):
    report_type: str = Field(..., pattern="^(balance_sheet|income_statement|cash_flow)$")
    period_start: datetime
    period_end: datetime
    include_insights: bool = True


class ReportResponse(BaseModel):
    id: int
    report_type: str
    period_start: datetime
    period_end: datetime
    data: dict
    insights: Optional[dict]
    created_at: datetime
    
    class Config:
        from_attributes = True
