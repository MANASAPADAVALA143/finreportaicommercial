from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
import pandas as pd
import io
from app.services.journal_ai_service import journal_ai_service
from app.core.database import get_db
from app.core.security import get_current_user

router = APIRouter(prefix="/api/journal-entries", tags=["journal-entries"])


@router.get("/ai-status")
async def get_ai_status():
    """
    Check if an LLM (Anthropic or Gemini) is configured for R2R journal entry analysis.
    """
    from app.services import llm_service

    ok = llm_service.is_configured()
    return {
        "aiAvailable": ok,
        "provider": llm_service.provider_label() if ok else None,
        "message": (
            f"{llm_service.provider_label()} is configured for journal entry AI analysis."
            if ok
            else "LLM unavailable. Set ANTHROPIC_API_KEY in backend/.env"
        ),
    }


@router.post("/upload")
async def upload_journal_entries(
    file: UploadFile = File(...),
    threshold: int = Form(40)
):
    """
    Upload and analyze journal entries from CSV or Excel file with configurable threshold.
    
    Supported formats: .csv, .xlsx, .xls
    Required columns: id, date, account, description, debit, credit, preparer, approver
    
    Args:
        file: CSV or Excel file containing journal entries
        threshold: Risk score threshold (10-90). Lower = more sensitive. Default = 40.
    """
    
    try:
        print(f"\n{'='*70}")
        print(f"   FRAUD DETECTION ANALYSIS")
        print(f"{'='*70}")
        print(f"   File: {file.filename}")
        print(f"   Detection Threshold: {threshold}")
        print(f"{'='*70}\n")
    except:
        pass
    
    # Validate file type
    allowed_extensions = ('.csv', '.xlsx', '.xls')
    if not file.filename.lower().endswith(allowed_extensions):
        raise HTTPException(
            status_code=400, 
            detail=f"Only CSV and Excel files are allowed. Supported formats: {', '.join(allowed_extensions)}"
        )
    
    try:
        # Read file based on extension
        contents = await file.read()
        
        if file.filename.lower().endswith('.csv'):
            # Read CSV with multiple encoding fallbacks
            try:
                df = pd.read_csv(io.StringIO(contents.decode('utf-8')))
            except UnicodeDecodeError:
                df = pd.read_csv(io.StringIO(contents.decode('latin-1')))
        else:
            # Read Excel (.xlsx or .xls)
            df = pd.read_excel(io.BytesIO(contents), engine='openpyxl')
        
        # CRITICAL FIX: Remove ALL currency symbols from ALL string columns
        for col in df.columns:
            if df[col].dtype == 'object':  # String columns
                df[col] = df[col].astype(str).str.replace('₹', '', regex=False)
                df[col] = df[col].str.replace('$', '', regex=False)
                df[col] = df[col].str.replace('€', '', regex=False)
                df[col] = df[col].str.replace('£', '', regex=False)
                df[col] = df[col].str.replace('¥', '', regex=False)
                df[col] = df[col].str.strip()
        
        # Normalize column names - handle common variations
        column_mapping = {
            # ID variations
            'ID': 'id',
            'Id': 'id',
            'JE_ID': 'id',
            'je_id': 'id',
            'entry_id': 'id',
            'EntryID': 'id',
            # Date variations
            'Date': 'date',
            'Posting_Date': 'date',
            'posting_date': 'date',
            'PostingDate': 'date',
            'transaction_date': 'date',
            # Account variations
            'Account': 'account',
            'account_code': 'account',
            'AccountCode': 'account',
            # Description variations
            'Description': 'description',
            'Desc': 'description',
            'desc': 'description',
            'Type': 'description',
            'type': 'description',
            # Debit variations
            'Debit': 'debit',
            'debit_amount': 'debit',
            'DebitAmount': 'debit',
            # Credit variations
            'Credit': 'credit',
            'credit_amount': 'credit',
            'CreditAmount': 'credit',
            # Preparer variations
            'Preparer': 'preparer',
            'Posted_By': 'preparer',
            'posted_by': 'preparer',
            'PostedBy': 'preparer',
            'prepared_by': 'preparer',
            'PreparedBy': 'preparer',
            'Vendor/Customer': 'preparer',
            # Approver variations
            'Approver': 'approver',
            'approved_by': 'approver',
            'ApprovedBy': 'approver',
        }
        
        # Apply column name normalization
        df.rename(columns=column_mapping, inplace=True)
        
        # Validate required columns
        required_columns = ['id', 'date', 'account', 'description', 'debit', 'credit']
        missing_columns = [col for col in required_columns if col not in df.columns]
        
        if missing_columns:
            raise HTTPException(
                status_code=400,
                detail=f"Missing required columns: {', '.join(missing_columns)}. Found columns: {', '.join(df.columns.tolist())}"
            )
        
        # Check if ground truth labels exist
        ground_truth = None
        if 'Is_Anomaly' in df.columns:
            ground_truth = df['Is_Anomaly'].tolist()
            try:
                print(f"[INFO] Ground truth found: {sum(ground_truth)} anomalies labeled out of {len(ground_truth)} total")
            except:
                pass  # Ignore print errors on Windows
        else:
            try:
                print(f"[INFO] No ground truth labels found (Is_Anomaly column missing)")
            except:
                pass  # Ignore print errors on Windows
        
        # Convert to dict
        entries = df.to_dict('records')
        
        # Analyze with LLM + rules - Complete analysis with metrics + custom threshold
        try:
            print(f"\n[START] Analyzing with threshold: {threshold}")
        except:
            pass
        
        analysis_result = journal_ai_service.analyze_batch_with_ground_truth(
            entries, 
            ground_truth, 
            threshold=threshold
        )
        
        # Extract high-risk entries for quick review
        high_risk_entries = [r for r in analysis_result['results'] if r.get('riskLevel') == 'High'][:10]
        results = analysis_result['results']
        ai_count = sum(1 for r in results if r.get("analysisSource") == "llm")
        rule_count = len(results) - ai_count

        return {
            "success": True,
            "file_name": file.filename,
            "threshold": threshold,
            "total": analysis_result['summary']['total'],
            "hasGroundTruth": ground_truth is not None,
            "summary": {
                **analysis_result['summary'],
                "aiEntryCount": ai_count,
                "ruleBasedEntryCount": rule_count,
                "aiUsed": ai_count > 0,
            },
            "metrics": analysis_result['metrics'],
            "confusionMatrix": analysis_result['confusionMatrix'],
            "results": results,
            "highRiskEntries": high_risk_entries,
        }
    
    except pd.errors.EmptyDataError:
        raise HTTPException(status_code=400, detail="CSV file is empty")
    
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Please use UTF-8")
    
    except Exception as e:
        # Log FULL error traceback for debugging
        import traceback
        full_error = traceback.format_exc()
        print("\n" + "="*60)
        print("[ERROR] FULL TRACEBACK:")
        print(full_error)
        print("="*60 + "\n")
        
        # Sanitize error message to remove Unicode characters for Windows compatibility
        error_msg = str(e).encode('ascii', errors='replace').decode('ascii')
        raise HTTPException(status_code=400, detail=f"Error processing file: {error_msg}")


@router.post("/analyze-single")
async def analyze_single_entry(
    entry: dict,
    current_user: dict = Depends(get_current_user)
):
    """
    Analyze single journal entry with LLM-assisted analysis.
    
    Entry should have: id, date, account, description, debit, credit, preparer, approver
    """
    
    # Validate required fields
    required_fields = ['id', 'date', 'account', 'description', 'debit', 'credit']
    missing_fields = [field for field in required_fields if field not in entry]
    
    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required fields: {', '.join(missing_fields)}"
        )
    
    try:
        result = journal_ai_service.analyze_journal_entry(entry)
        
        return {
            "success": True,
            "entry_id": entry.get('id'),
            "result": result,
            "recommendation": _get_recommendation(result)
        }
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Analysis error: {str(e)}")


@router.post("/analyze-batch")
async def analyze_batch_entries(
    entries: List[dict],
    current_user: dict = Depends(get_current_user)
):
    """
    Analyze multiple journal entries (JSON array).
    
    Useful for API-based batch analysis without CSV upload.
    """
    
    if not entries:
        raise HTTPException(status_code=400, detail="No entries provided")
    
    if len(entries) > 1000:
        raise HTTPException(status_code=400, detail="Maximum 1000 entries per batch")
    
    try:
        results = journal_ai_service.analyze_batch(entries)
        
        # Summary statistics
        total_risk_score = sum(r.get('riskScore', 0) for r in results)
        avg_risk_score = total_risk_score / len(results) if results else 0
        
        high_risk = [r for r in results if r.get('riskScore', 0) > 70]
        
        return {
            "success": True,
            "total_analyzed": len(results),
            "average_risk_score": round(avg_risk_score, 2),
            "high_risk_count": len(high_risk),
            "results": results
        }
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Batch analysis error: {str(e)}")


def _get_recommendation(analysis: dict) -> str:
    """Get action recommendation based on analysis."""
    risk_score = analysis.get('riskScore', 0)
    risk_level = analysis.get('riskLevel', 'Unknown')
    
    if risk_score >= 80:
        return "URGENT: Requires immediate review and investigation"
    elif risk_score >= 60:
        return "HIGH PRIORITY: Review within 24 hours"
    elif risk_score >= 40:
        return "MEDIUM PRIORITY: Review within 3 business days"
    else:
        return "LOW PRIORITY: Routine audit sufficient"
