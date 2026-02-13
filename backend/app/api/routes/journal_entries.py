from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.core.database import get_db
from app.core.security import get_current_user
from app.api.models import JournalEntry
from app.api.schemas import JournalEntryCreate, JournalEntryResponse
from app.services.fraud_detection import fraud_detection_service
from app.services.ml_service import ml_service

router = APIRouter(prefix="/journal-entries", tags=["Journal Entries"])


@router.post("/", response_model=JournalEntryResponse, status_code=status.HTTP_201_CREATED)
async def create_journal_entry(
    entry_data: JournalEntryCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Create a new journal entry with fraud detection."""
    user_id = int(current_user["user_id"])
    
    # Get historical entries for pattern analysis
    historical = db.query(JournalEntry).filter(
        JournalEntry.user_id == user_id
    ).order_by(JournalEntry.created_at.desc()).limit(50).all()
    
    historical_dicts = [
        {
            "debit": e.debit,
            "credit": e.credit,
            "description": e.description,
            "account": e.account,
            "entry_date": e.entry_date
        }
        for e in historical
    ]
    
    # Perform fraud detection
    fraud_analysis = fraud_detection_service.analyze_transaction(
        entry_data.dict(),
        historical_dicts
    )
    
    # Perform ML anomaly detection if trained
    is_anomaly, anomaly_score = ml_service.detect_anomaly(entry_data.dict())
    
    # Combine scores
    combined_fraud_score = (fraud_analysis["fraud_score"] + anomaly_score) / 2
    
    # Create journal entry
    new_entry = JournalEntry(
        user_id=user_id,
        entry_date=entry_data.entry_date,
        description=entry_data.description,
        account=entry_data.account,
        debit=entry_data.debit,
        credit=entry_data.credit,
        reference=entry_data.reference,
        fraud_score=combined_fraud_score,
        anomaly_detected=is_anomaly or fraud_analysis["requires_review"],
        status="pending" if fraud_analysis["requires_review"] else "approved",
        metadata={
            "fraud_analysis": fraud_analysis,
            "ml_anomaly_score": anomaly_score
        }
    )
    
    db.add(new_entry)
    db.commit()
    db.refresh(new_entry)
    
    return new_entry


@router.get("/", response_model=List[JournalEntryResponse])
async def get_journal_entries(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    status: Optional[str] = None,
    account: Optional[str] = None,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get journal entries with optional filters."""
    user_id = int(current_user["user_id"])
    
    query = db.query(JournalEntry).filter(JournalEntry.user_id == user_id)
    
    if status:
        query = query.filter(JournalEntry.status == status)
    
    if account:
        query = query.filter(JournalEntry.account.ilike(f"%{account}%"))
    
    entries = query.order_by(JournalEntry.created_at.desc()).offset(skip).limit(limit).all()
    
    return entries


@router.get("/{entry_id}", response_model=JournalEntryResponse)
async def get_journal_entry(
    entry_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get a specific journal entry."""
    user_id = int(current_user["user_id"])
    
    entry = db.query(JournalEntry).filter(
        JournalEntry.id == entry_id,
        JournalEntry.user_id == user_id
    ).first()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Journal entry not found"
        )
    
    return entry


@router.put("/{entry_id}/approve")
async def approve_journal_entry(
    entry_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Approve a pending journal entry."""
    user_id = int(current_user["user_id"])
    
    entry = db.query(JournalEntry).filter(
        JournalEntry.id == entry_id,
        JournalEntry.user_id == user_id
    ).first()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Journal entry not found"
        )
    
    entry.status = "approved"
    db.commit()
    
    return {"message": "Journal entry approved", "entry_id": entry_id}


@router.delete("/{entry_id}")
async def delete_journal_entry(
    entry_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete a journal entry."""
    user_id = int(current_user["user_id"])
    
    entry = db.query(JournalEntry).filter(
        JournalEntry.id == entry_id,
        JournalEntry.user_id == user_id
    ).first()
    
    if not entry:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Journal entry not found"
        )
    
    db.delete(entry)
    db.commit()
    
    return {"message": "Journal entry deleted"}
