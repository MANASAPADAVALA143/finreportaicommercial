"""
Stateful R2R: company-specific learning (MindBridge-style).
POST /api/companies, GET /api/companies, POST /api/analyze, POST /api/feedback, GET /api/companies/{id}/profile

IMPORTANT: This is the backend only.
Frontend patternAnalysis.ts stays unchanged.
Only new files: db/models.py, db/database.py,
services/baseline_service.py, services/scoring_service.py
+ updates to main.py
"""
import io
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
import pandas as pd

from app.core.database import get_db
from app.db.models import Company, CompanyProfile, JournalHistory, ScoringResult
from app.services.baseline_service import recalculate_company_baseline
from app.services.scoring_service import score_entry_against_company_baseline

router = APIRouter(prefix="/api", tags=["stateful-journal"])

# Column mapping: upload file columns → our schema
UPLOAD_TO_ENTRY = {
    "id": "journal_id",
    "date": "posting_date",
    "account": "account",
    "description": "description",
    "debit": "debit",
    "credit": "credit",
    "preparer": "user_id",
    "approver": "approver",
    "Vendor/Customer": "vendor",
    "vendor": "vendor",
    "entity": "entity",
    "source": "source",
}


def _normalize_df_to_entries(df: pd.DataFrame) -> list[dict]:
    """Normalize upload DataFrame to entry dicts with journal_id, posting_date, amount, account, etc."""
    # Normalize column names (same as upload_routes)
    column_mapping = {
        "ID": "id", "Id": "id", "JE_ID": "id", "je_id": "id", "entry_id": "id", "EntryID": "id",
        "Date": "date", "Posting_Date": "date", "posting_date": "date", "PostingDate": "date", "transaction_date": "date",
        "Account": "account", "account_code": "account", "AccountCode": "account",
        "Description": "description", "Desc": "description", "desc": "description", "Type": "description", "type": "description",
        "Debit": "debit", "debit_amount": "debit", "DebitAmount": "debit",
        "Credit": "credit", "credit_amount": "credit", "CreditAmount": "credit",
        "Preparer": "preparer", "Posted_By": "preparer", "posted_by": "preparer", "PostedBy": "preparer", "prepared_by": "preparer", "PreparedBy": "preparer",
        "Approver": "approver", "approved_by": "approver", "ApprovedBy": "approver",
        "Vendor/Customer": "vendor", "Vendor": "vendor", "vendor": "vendor", "Customer": "vendor",
        "Entity": "entity", "entity": "entity",
        "Source": "source", "source": "source",
    }
    df = df.rename(columns=column_mapping)
    for col in df.columns:
        if df[col].dtype == "object":
            df[col] = df[col].astype(str).str.replace("₹", "", regex=False).str.strip()
    required = ["id", "date", "account", "description", "debit", "credit"]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise HTTPException(status_code=400, detail=f"Missing columns: {', '.join(missing)}. Found: {', '.join(df.columns.tolist())}")

    entries = []
    for _, row in df.iterrows():
        debit = float(row.get("debit", 0) or 0)
        credit = float(row.get("credit", 0) or 0)
        amount = debit if debit else credit
        if amount == 0:
            amount = debit or credit
        try:
            posting_date = pd.to_datetime(row.get("date"), errors="coerce")
            if pd.isna(posting_date):
                posting_date = datetime.utcnow()
        except Exception:
            posting_date = datetime.utcnow()
        entries.append({
            "journal_id": str(row.get("id", "")),
            "posting_date": posting_date,
            "amount": amount,
            "account": str(row.get("account", "Unknown")),
            "vendor": str(row.get("vendor", row.get("entity", "Unknown"))),
            "entity": str(row.get("entity", row.get("vendor", ""))),
            "user_id": str(row.get("preparer", "Unknown")),
            "source": str(row.get("source", "Unknown")),
            "description": str(row.get("description", "")),
        })
    return entries


@router.post("/companies")
def create_company(
    name: str,
    industry: str = "General",
    db: Session = Depends(get_db),
):
    company_id = f"client_{uuid.uuid4().hex[:8]}"
    company = Company(id=company_id, name=name, industry=industry)
    db.add(company)
    db.commit()
    db.refresh(company)
    return {"company_id": company_id, "name": name, "industry": industry}


@router.get("/companies")
def list_companies(db: Session = Depends(get_db)):
    companies = db.query(Company).order_by(Company.name).all()
    return [
        {
            "id": c.id,
            "name": c.name,
            "industry": c.industry,
            "total_uploads": c.total_uploads,
            "last_upload": c.last_upload.isoformat() if c.last_upload else None,
        }
        for c in companies
    ]


@router.post("/analyze")
async def analyze_journal_entries(
    file: UploadFile = File(...),
    company_id: str = Form(...),
    db: Session = Depends(get_db),
):
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id is required")
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    contents = await file.read()
    try:
        if file.filename and file.filename.lower().endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")
        else:
            df = pd.read_csv(io.BytesIO(contents))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not read file: {e}")

    raw_entries = _normalize_df_to_entries(df)
    if not raw_entries:
        raise HTTPException(status_code=400, detail="No valid entries in file")

    batch_id = f"batch_{uuid.uuid4().hex[:8]}"

    for ent in raw_entries:
        row = JournalHistory(
            company_id=company_id,
            journal_id=ent.get("journal_id"),
            posting_date=ent.get("posting_date"),
            amount=float(ent.get("amount", 0)),
            account=ent.get("account", "Unknown"),
            vendor=ent.get("vendor", "Unknown"),
            user_id=ent.get("user_id", "Unknown"),
            source=ent.get("source", "Unknown"),
            description=ent.get("description", ""),
            entity=ent.get("entity", ""),
            upload_batch=batch_id,
        )
        db.add(row)
    db.commit()

    recalculate_company_baseline(company_id, db)

    scored = []
    for entry in raw_entries:
        result = score_entry_against_company_baseline(entry, company_id, raw_entries, db)
        scored.append(result)
        sr = ScoringResult(
            company_id=company_id,
            journal_id=result["journal_id"],
            upload_batch=batch_id,
            final_score=result["final_score"],
            risk_level=result["risk_level"],
            ml_score=result["ml_score"],
            stat_score=result["stat_score"],
            rules_score=result["rules_score"],
            rule_flags=result["rule_flags"],
        )
        db.add(sr)
    db.commit()

    company.total_uploads += 1
    company.last_upload = datetime.utcnow()
    db.commit()

    high = sum(1 for e in scored if e["risk_level"] == "HIGH")
    medium = sum(1 for e in scored if e["risk_level"] == "MEDIUM")
    low = sum(1 for e in scored if e["risk_level"] == "LOW")
    total = len(scored)
    anomaly_rate = round((high + medium) / total * 100, 1) if total else 0

    # Shape for frontend: same as existing R2R upload response where possible
    entries_for_ui = [
        {
            "entryId": e["journal_id"],
            "riskScore": e["final_score"],
            "riskLevel": e["risk_level"],
            "anomalies": e["rule_flags"],
            "shapBreakdown": {
                "amountAnomaly": min(e["stat_score"], 100),
                "temporalAnomaly": 0,
                "behavioralAnomaly": min(e["rules_score"], 100),
                "accountAnomaly": 0,
            },
            "statisticalAnalysis": {"zScore": 0, "percentile": 0},
            "explanation": " ".join(e["rule_flags"]) or "No flags",
            "recommendation": "Review" if e["risk_level"] == "HIGH" else "Monitor" if e["risk_level"] == "MEDIUM" else "OK",
        }
        for e in sorted(scored, key=lambda x: -x["final_score"])
    ]

    return {
        "success": True,
        "batch_id": batch_id,
        "company_id": company_id,
        "total": total,
        "high": high,
        "medium": medium,
        "low": low,
        "anomaly_rate": anomaly_rate,
        "summary": {
            "total": total,
            "highRisk": high,
            "mediumRisk": medium,
            "lowRisk": low,
            "novaUsed": False,
            "novaEntryCount": 0,
        },
        "entries": scored,
        "results": entries_for_ui,
    }


@router.post("/feedback")
def save_feedback(
    company_id: str,
    journal_id: str,
    is_real: bool,
    reviewed_by: str = "auditor",
    db: Session = Depends(get_db),
):
    result = (
        db.query(ScoringResult)
        .filter(ScoringResult.company_id == company_id, ScoringResult.journal_id == journal_id)
        .order_by(ScoringResult.created_at.desc())
        .first()
    )
    if result:
        result.user_label = is_real
        result.reviewed_by = reviewed_by
        result.reviewed_at = datetime.utcnow()
        db.commit()
    return {"status": "saved", "will_improve_next_analysis": True}


@router.get("/companies/{company_id}/profile")
def get_company_profile(company_id: str, db: Session = Depends(get_db)):
    profiles = db.query(CompanyProfile).filter(CompanyProfile.company_id == company_id).all()
    return {
        "company_id": company_id,
        "accounts_learned": len(profiles),
        "profiles": [
            {
                "account": p.account,
                "avg_amount": round(p.avg_amount),
                "p95_amount": round(p.p95_amount),
                "entry_count": p.entry_count,
                "weekend_rate": round(p.weekend_rate * 100, 1),
                "last_updated": str(p.last_updated),
            }
            for p in profiles
        ],
    }
