from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Dict
from datetime import datetime, timedelta
from app.core.database import get_db
from app.core.security import get_current_user
from app.api.models import JournalEntry
from app.api.schemas import AnalyticsQuery, AnalyticsResponse
from app.services.ml_service import ml_service

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/dashboard")
async def get_dashboard_analytics(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get comprehensive dashboard analytics."""
    user_id = int(current_user["user_id"])
    
    # Get date ranges
    today = datetime.utcnow()
    month_ago = today - timedelta(days=30)
    
    # Total entries
    total_entries = db.query(func.count(JournalEntry.id)).filter(
        JournalEntry.user_id == user_id
    ).scalar()
    
    # Entries this month
    entries_this_month = db.query(func.count(JournalEntry.id)).filter(
        JournalEntry.user_id == user_id,
        JournalEntry.created_at >= month_ago
    ).scalar()
    
    # Flagged entries
    flagged_entries = db.query(func.count(JournalEntry.id)).filter(
        JournalEntry.user_id == user_id,
        JournalEntry.anomaly_detected == True
    ).scalar()
    
    # Total debits and credits
    debits = db.query(func.sum(JournalEntry.debit)).filter(
        JournalEntry.user_id == user_id
    ).scalar() or 0
    
    credits = db.query(func.sum(JournalEntry.credit)).filter(
        JournalEntry.user_id == user_id
    ).scalar() or 0
    
    # Entries by status
    status_breakdown = db.query(
        JournalEntry.status,
        func.count(JournalEntry.id)
    ).filter(
        JournalEntry.user_id == user_id
    ).group_by(JournalEntry.status).all()
    
    # Top accounts
    top_accounts = db.query(
        JournalEntry.account,
        func.count(JournalEntry.id).label('count'),
        func.sum(JournalEntry.debit + JournalEntry.credit).label('total')
    ).filter(
        JournalEntry.user_id == user_id
    ).group_by(JournalEntry.account).order_by(func.count(JournalEntry.id).desc()).limit(10).all()
    
    return {
        "summary": {
            "total_entries": total_entries,
            "entries_this_month": entries_this_month,
            "flagged_entries": flagged_entries,
            "total_debits": float(debits),
            "total_credits": float(credits),
            "balance": float(debits - credits)
        },
        "status_breakdown": {
            status: count for status, count in status_breakdown
        },
        "top_accounts": [
            {
                "account": acc,
                "entry_count": int(count),
                "total_amount": float(total)
            }
            for acc, count, total in top_accounts
        ]
    }


@router.get("/trends")
async def get_trends(
    days: int = Query(30, ge=7, le=365),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get trend analysis over time."""
    user_id = int(current_user["user_id"])
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Get entries for trend analysis
    entries = db.query(JournalEntry).filter(
        JournalEntry.user_id == user_id,
        JournalEntry.created_at >= start_date
    ).order_by(JournalEntry.entry_date).all()
    
    if not entries:
        return {
            "trend": "insufficient_data",
            "data_points": []
        }
    
    # Prepare time series data
    time_series = []
    for entry in entries:
        time_series.append({
            "date": entry.entry_date.isoformat(),
            "value": entry.debit + entry.credit
        })
    
    # Perform trend analysis
    analysis = ml_service.trend_analysis(time_series)
    
    return {
        "period_days": days,
        "data_points": len(time_series),
        "analysis": analysis,
        "time_series": time_series[-30:]  # Return last 30 points
    }


@router.get("/financial-ratios")
async def get_financial_ratios(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Calculate key financial ratios."""
    user_id = int(current_user["user_id"])
    
    # Get aggregated financial data
    # In a real system, this would come from balance sheet and income statement
    total_debits = db.query(func.sum(JournalEntry.debit)).filter(
        JournalEntry.user_id == user_id
    ).scalar() or 0
    
    total_credits = db.query(func.sum(JournalEntry.credit)).filter(
        JournalEntry.user_id == user_id
    ).scalar() or 0
    
    # Mock financial data for ratio calculation
    financial_data = {
        "current_assets": total_debits * 0.4,
        "current_liabilities": total_credits * 0.3,
        "total_assets": total_debits,
        "total_debt": total_credits * 0.6,
        "total_equity": total_debits - (total_credits * 0.6),
        "revenue": total_credits,
        "net_income": (total_credits - total_debits) * 0.1
    }
    
    ratios = ml_service.analyze_financial_ratios(financial_data)
    
    return {
        "ratios": ratios,
        "analysis": {
            "liquidity": "healthy" if ratios.get("current_ratio", 0) > 1.5 else "concerning",
            "profitability": "strong" if ratios.get("profit_margin", 0) > 10 else "weak",
            "leverage": "acceptable" if ratios.get("debt_to_equity", 0) < 2 else "high"
        }
    }


@router.post("/query", response_model=AnalyticsResponse)
async def query_analytics(
    query: AnalyticsQuery,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Run custom analytics query."""
    user_id = int(current_user["user_id"])
    
    # This is a simplified implementation
    # In production, you'd want to parse the query and execute appropriate analytics
    
    result = {
        "query": query.query,
        "status": "processed",
        "data": {}
    }
    
    insights = [
        "Analytics query processed successfully",
        "Consider reviewing flagged entries",
        "Financial ratios are within normal ranges"
    ]
    
    return AnalyticsResponse(
        result=result,
        insights=insights
    )


@router.get("/anomalies")
async def get_anomalies(
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get entries flagged as anomalies."""
    user_id = int(current_user["user_id"])
    
    anomalies = db.query(JournalEntry).filter(
        JournalEntry.user_id == user_id,
        JournalEntry.anomaly_detected == True
    ).order_by(JournalEntry.fraud_score.desc()).limit(limit).all()
    
    return {
        "total_anomalies": len(anomalies),
        "entries": [
            {
                "id": e.id,
                "date": e.entry_date,
                "account": e.account,
                "amount": e.debit + e.credit,
                "fraud_score": e.fraud_score,
                "description": e.description,
                "risk_factors": e.metadata.get("fraud_analysis", {}).get("risk_factors", [])
            }
            for e in anomalies
        ]
    }
