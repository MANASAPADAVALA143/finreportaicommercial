from fastapi import APIRouter, HTTPException, status, Header
from pydantic import BaseModel, EmailStr
from typing import Optional
from app.core.config import settings
from app.core.supabase import get_supabase

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])

# Models
class UserRegister(BaseModel):
    email: EmailStr
    password: str
    full_name: Optional[str] = None
    company: Optional[str] = None

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: dict

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: Optional[str] = None
    company: Optional[str] = None
    role: str = "user"

@router.post("/register", response_model=Token, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserRegister):
    """Register a new user with Supabase"""
    
    try:
        supabase = get_supabase()
        
        # Register user with Supabase Auth
        auth_response = supabase.auth.sign_up({
            "email": user_data.email,
            "password": user_data.password,
            "options": {
                "data": {
                    "full_name": user_data.full_name,
                    "company": user_data.company,
                    "role": "user"
                }
            }
        })
        
        if not auth_response.user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Registration failed"
            )
        
        # Store additional user profile in Supabase database
        profile_data = {
            "id": auth_response.user.id,
            "email": user_data.email,
            "full_name": user_data.full_name,
            "company": user_data.company,
            "role": "user"
        }
        
        supabase.table("user_profiles").upsert(profile_data).execute()
        
        return Token(
            access_token=auth_response.session.access_token,
            refresh_token=auth_response.session.refresh_token,
            user={
                "id": auth_response.user.id,
                "email": auth_response.user.email,
                "full_name": user_data.full_name,
                "company": user_data.company,
                "role": "user"
            }
        )
        
    except Exception as e:
        error_msg = str(e)
        if "already registered" in error_msg.lower() or "duplicate" in error_msg.lower():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration error: {error_msg}"
        )

@router.post("/login", response_model=Token)
async def login(user_data: UserLogin):
    """Login user with Supabase and return JWT tokens"""
    
    try:
        supabase = get_supabase()
        
        # Authenticate with Supabase
        auth_response = supabase.auth.sign_in_with_password({
            "email": user_data.email,
            "password": user_data.password
        })
        
        if not auth_response.user or not auth_response.session:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect email or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
        
        # Get user profile from database
        profile_response = supabase.table("user_profiles").select("*").eq("id", auth_response.user.id).execute()
        
        user_profile = {}
        if profile_response.data and len(profile_response.data) > 0:
            user_profile = profile_response.data[0]
        
        return Token(
            access_token=auth_response.session.access_token,
            refresh_token=auth_response.session.refresh_token,
            user={
                "id": auth_response.user.id,
                "email": auth_response.user.email,
                "full_name": user_profile.get("full_name"),
                "company": user_profile.get("company"),
                "role": user_profile.get("role", "user")
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

@router.get("/me", response_model=UserResponse)
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Get current user info by verifying JWT token"""
    
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated"
        )
    
    try:
        token = authorization.replace("Bearer ", "")
        supabase = get_supabase()
        
        # Verify token with Supabase
        user_response = supabase.auth.get_user(token)
        
        if not user_response.user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token"
            )
        
        # Get user profile
        profile_response = supabase.table("user_profiles").select("*").eq("id", user_response.user.id).execute()
        
        user_profile = {}
        if profile_response.data and len(profile_response.data) > 0:
            user_profile = profile_response.data[0]
        
        return UserResponse(
            id=user_response.user.id,
            email=user_response.user.email,
            full_name=user_profile.get("full_name"),
            company=user_profile.get("company"),
            role=user_profile.get("role", "user")
        )
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token"
        )

@router.post("/logout")
async def logout(authorization: Optional[str] = Header(None)):
    """Logout user from Supabase"""
    
    if not authorization or not authorization.startswith("Bearer "):
        return {"message": "Already logged out"}
    
    try:
        token = authorization.replace("Bearer ", "")
        supabase = get_supabase()
        supabase.auth.sign_out()
        return {"message": "Successfully logged out"}
    except:
        return {"message": "Successfully logged out"}
