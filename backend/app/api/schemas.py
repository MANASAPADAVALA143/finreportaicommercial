from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


# User Schemas
class UserCreate(BaseModel):
    """Schema for creating a new user."""
    email: EmailStr
    password: str = Field(..., min_length=8)
    full_name: Optional[str] = None
    company: Optional[str] = None


class UserResponse(BaseModel):
    """Schema for user response."""
    id: int
    email: str
    full_name: Optional[str]
    company: Optional[str]
    is_active: bool
    created_at: datetime
    
    class Config:
        from_attributes = True


# Journal Entry Schemas
class JournalEntryCreate(BaseModel):
    """Schema for creating a journal entry."""
    entry_date: datetime
    description: str = Field(..., min_length=1, max_length=1000)
    account: str = Field(..., min_length=1, max_length=200)
    debit: float = Field(default=0.0, ge=0)
    credit: float = Field(default=0.0, ge=0)
    reference: Optional[str] = Field(None, max_length=100)


class JournalEntryResponse(BaseModel):
    """Schema for journal entry response."""
    id: int
    user_id: int
    entry_date: datetime
    description: str
    account: str
    debit: float
    credit: float
    reference: Optional[str]
    status: str
    fraud_score: Optional[float] = 0.0
    anomaly_detected: bool = False
    created_at: datetime
    
    class Config:
        from_attributes = True


# Auth Schemas
class Token(BaseModel):
    """Schema for authentication token."""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Schema for token data."""
    email: Optional[str] = None
