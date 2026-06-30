from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from app.core.config import settings
from app.services.auth_service import hash_password, verify_password

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def get_password_hash(password: str) -> str:
    """Generate password hash (delegates to auth_service — single bcrypt call)."""
    return hash_password(password)


__all__ = ["get_password_hash", "hash_password", "verify_password", "oauth2_scheme", "create_access_token", "create_refresh_token", "get_current_user"]


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Create JWT access token."""
    to_encode = data.copy()
    
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    """Get current authenticated user from token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    # DEMO MODE - Accept demo tokens
    if token.startswith("demo-token-"):
        return {
            "user_id": "demo-user",
            "email": "demo@finreportai.com"
        }
    
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        user_id: str = payload.get("sub")
        email: str = payload.get("email")
        
        if user_id is None:
            raise credentials_exception
            
        return {"user_id": user_id, "email": email}
        
    except JWTError:
        raise credentials_exception
