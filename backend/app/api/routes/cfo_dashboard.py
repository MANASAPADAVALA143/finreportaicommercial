from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import random
import os
import pandas as pd
import json
import tempfile
from pathlib import Path
from app.core.company_access import require_workspace_level
from app.core.database import get_db
from app.core.tenant_scope import platform_admin, workspace_reader
from app.middleware.workspace import WorkspaceContext, validate_workspace
from app.services.cfo_metrics_calculator import CFOMetricsCalculator
from app.services.accounting_integrations import AccountingIntegrationFactory
from app.services.trial_balance_parser import TrialBalanceParser

router = APIRouter(prefix="/api/cfo", tags=["cfo-dashboard"], dependencies=[Depends(workspace_reader)])


def _private_copy(content: bytes, filename: str | None) -> str:
    """Write an upload to a private temp file (never a path derived from the client's filename)."""
    suffix = Path(filename or "").suffix.lower()
    if suffix not in (".csv", ".xlsx", ".xls"):
        suffix = ".csv"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(content)
        return tmp.name

# Path to financial data files (legacy sample-file path — not the posted UAE ledger)
JOURNAL_ENTRIES_PATH = "sample_journal_entries.csv"
TRIAL_BALANCE_PATH = "trial_balance.csv"

_NO_LIVE_DATA_DETAIL = (
    "CFO dashboard has no live data source. "
    "Upload a trial balance or journal file, or connect the posted ledger. "
    "Fabricated metrics are never returned."
)


def _load_dashboard_data(time_range: str) -> Dict[str, Any]:
    """Load dashboard metrics from an on-disk sample file, or raise 501.

    Never returns hard-coded financial figures. Sample CSV/XLS paths are a legacy
    bridge only; the posted UAE ledger is the intended future authority.
    """
    try:
        if os.path.exists(TRIAL_BALANCE_PATH):
            parser = TrialBalanceParser(TRIAL_BALANCE_PATH)
            return parser.calculate_dashboard_metrics()
        if os.path.exists(JOURNAL_ENTRIES_PATH):
            calculator = CFOMetricsCalculator(JOURNAL_ENTRIES_PATH)
            return calculator.calculate_all_metrics(time_range)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"CFO dashboard data source failed: {e}",
        ) from e
    raise HTTPException(status_code=501, detail=_NO_LIVE_DATA_DETAIL)


@router.get("/dashboard")
async def get_dashboard_data(
    time_range: str = Query("month", json_schema_extra={"enum": ["week", "month", "quarter", "year"]})
):
    """Get CFO dashboard data from a configured file source, or 501 if none."""
    return _load_dashboard_data(time_range)

@router.post("/export")
async def export_dashboard(
    format: str = Query(..., json_schema_extra={"enum": ["pdf", "excel", "csv"]}),
    time_range: str = Query("month")
):
    """Export dashboard data in specified format. Fails closed when no live source exists."""
    dashboard_data = _load_dashboard_data(time_range)
    filename = f"cfo-dashboard-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    try:
        if format == "csv":
            return _export_csv(dashboard_data, filename)
        if format == "excel":
            return _export_excel(dashboard_data, filename)
        if format == "pdf":
            return _export_pdf(dashboard_data, filename)
        raise HTTPException(status_code=400, detail=f"Unsupported export format: {format}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Export failed: {str(e)}") from e

def _export_csv(data: Dict[str, Any], filename: str):
    """Export dashboard data as CSV"""
    from fastapi.responses import StreamingResponse
    import io
    
    # Create CSV content
    output = io.StringIO()
    output.write("CFO Dashboard Export\n")
    output.write(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
    
    # Health Score
    output.write("Financial Health Score\n")
    output.write(f"Overall Score,{data['healthScore']['overall']}\n")
    output.write(f"Liquidity,{data['healthScore']['breakdown']['liquidity']}\n")
    output.write(f"Profitability,{data['healthScore']['breakdown']['profitability']}\n")
    output.write(f"Efficiency,{data['healthScore']['breakdown']['efficiency']}\n")
    output.write(f"Stability,{data['healthScore']['breakdown']['stability']}\n\n")
    
    # Cash
    output.write("Cash Position\n")
    output.write(f"Current Balance,${data['cash']['current']:,}\n")
    output.write(f"Runway (months),{data['cash']['runway']}\n")
    output.write(f"Trend,{data['cash']['trend']}%\n\n")
    
    # Revenue
    output.write("Revenue\n")
    output.write(f"Monthly Revenue,${data['revenue']['monthly']:,}\n")
    output.write(f"Annual Run Rate,${data['revenue']['arr']:,}\n")
    output.write(f"Growth,{data['revenue']['growth']}%\n\n")
    
    # Expenses
    output.write("Expenses\n")
    output.write(f"Monthly Expenses,${data['expenses']['monthly']:,}\n")
    output.write(f"Trend,{data['expenses']['trend']}%\n\n")
    
    output.write("Expense Categories\n")
    for cat in data['expenses']['categories']:
        output.write(f"{cat['name']},${cat['value']:,},{cat['percentage']}%\n")
    
    output.write("\n")
    
    # Financial Ratios
    output.write("Financial Ratios\n")
    output.write(f"Current Ratio,{data['ratios']['currentRatio']}\n")
    output.write(f"Quick Ratio,{data['ratios']['quickRatio']}\n")
    output.write(f"Debt-to-Equity,{data['ratios']['debtToEquity']}\n")
    output.write(f"ROE,{data['ratios']['roe']}%\n")
    output.write(f"Operating Margin,{data['ratios']['operatingMargin']}%\n")
    
    # Create response
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode('utf-8')),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}.csv"}
    )

def _export_excel(data: Dict[str, Any], filename: str):
    """Export dashboard data as Excel"""
    from fastapi.responses import StreamingResponse
    import io
    
    try:
        import openpyxl
        from openpyxl.styles import Font, Alignment, PatternFill
        
        # Create workbook
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "CFO Dashboard"
        
        # Title
        ws['A1'] = "CFO Dashboard Export"
        ws['A1'].font = Font(bold=True, size=16)
        ws['A2'] = f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
        
        row = 4
        
        # Health Score
        ws[f'A{row}'] = "Financial Health Score"
        ws[f'A{row}'].font = Font(bold=True, size=14)
        row += 1
        ws[f'A{row}'] = "Overall Score"
        ws[f'B{row}'] = data['healthScore']['overall']
        row += 1
        ws[f'A{row}'] = "Liquidity"
        ws[f'B{row}'] = data['healthScore']['breakdown']['liquidity']
        row += 1
        ws[f'A{row}'] = "Profitability"
        ws[f'B{row}'] = data['healthScore']['breakdown']['profitability']
        row += 1
        ws[f'A{row}'] = "Efficiency"
        ws[f'B{row}'] = data['healthScore']['breakdown']['efficiency']
        row += 1
        ws[f'A{row}'] = "Stability"
        ws[f'B{row}'] = data['healthScore']['breakdown']['stability']
        row += 2
        
        # Cash
        ws[f'A{row}'] = "Cash Position"
        ws[f'A{row}'].font = Font(bold=True, size=14)
        row += 1
        ws[f'A{row}'] = "Current Balance"
        ws[f'B{row}'] = f"${data['cash']['current']:,}"
        row += 1
        ws[f'A{row}'] = "Runway (months)"
        ws[f'B{row}'] = data['cash']['runway']
        row += 2
        
        # Revenue
        ws[f'A{row}'] = "Revenue"
        ws[f'A{row}'].font = Font(bold=True, size=14)
        row += 1
        ws[f'A{row}'] = "Monthly Revenue"
        ws[f'B{row}'] = f"${data['revenue']['monthly']:,}"
        row += 1
        ws[f'A{row}'] = "Annual Run Rate"
        ws[f'B{row}'] = f"${data['revenue']['arr']:,}"
        row += 1
        ws[f'A{row}'] = "Growth"
        ws[f'B{row}'] = f"{data['revenue']['growth']}%"
        row += 2
        
        # Expenses
        ws[f'A{row}'] = "Expenses"
        ws[f'A{row}'].font = Font(bold=True, size=14)
        row += 1
        ws[f'A{row}'] = "Monthly Expenses"
        ws[f'B{row}'] = f"${data['expenses']['monthly']:,}"
        row += 2
        
        ws[f'A{row}'] = "Category"
        ws[f'B{row}'] = "Amount"
        ws[f'C{row}'] = "Percentage"
        ws[f'A{row}'].font = Font(bold=True)
        ws[f'B{row}'].font = Font(bold=True)
        ws[f'C{row}'].font = Font(bold=True)
        row += 1
        
        for cat in data['expenses']['categories']:
            ws[f'A{row}'] = cat['name']
            ws[f'B{row}'] = f"${cat['value']:,}"
            ws[f'C{row}'] = f"{cat['percentage']}%"
            row += 1
        
        # Save to bytes
        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}.xlsx"}
        )
    
    except ImportError:
        # Fallback to CSV if openpyxl not installed
        raise HTTPException(status_code=500, detail="Excel export requires openpyxl library. Please install: pip install openpyxl")

def _export_pdf(data: Dict[str, Any], filename: str):
    """Export dashboard data as PDF (simplified text-based)"""
    from fastapi.responses import Response
    
    # Simple text-based PDF alternative (plain text)
    content = f"""CFO DASHBOARD EXPORT
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

FINANCIAL HEALTH SCORE: {data['healthScore']['overall']}/100
  - Liquidity: {data['healthScore']['breakdown']['liquidity']}
  - Profitability: {data['healthScore']['breakdown']['profitability']}
  - Efficiency: {data['healthScore']['breakdown']['efficiency']}
  - Stability: {data['healthScore']['breakdown']['stability']}

CASH POSITION: ${data['cash']['current']:,}
  - Runway: {data['cash']['runway']} months
  - Trend: {data['cash']['trend']}%

REVENUE
  - Monthly: ${data['revenue']['monthly']:,}
  - Annual Run Rate: ${data['revenue']['arr']:,}
  - Growth: {data['revenue']['growth']}% YoY

EXPENSES
  - Monthly: ${data['expenses']['monthly']:,}
  - Trend: {data['expenses']['trend']}%

EXPENSE CATEGORIES:
"""
    
    for cat in data['expenses']['categories']:
        content += f"  - {cat['name']}: ${cat['value']:,} ({cat['percentage']}%)\n"
    
    content += f"""
FINANCIAL RATIOS
  - Current Ratio: {data['ratios']['currentRatio']}
  - Quick Ratio: {data['ratios']['quickRatio']}
  - Debt-to-Equity: {data['ratios']['debtToEquity']}
  - ROE: {data['ratios']['roe']}%
  - Operating Margin: {data['ratios']['operatingMargin']}%
"""
    
    return Response(
        content=content.encode('utf-8'),
        media_type="text/plain",
        headers={"Content-Disposition": f"attachment; filename={filename}.txt"}
    )

@router.get("/insights")
async def get_ai_insights():
    """AI insights require a live ledger-backed source — never return fabricated figures."""
    raise HTTPException(status_code=501, detail=_NO_LIVE_DATA_DETAIL)

@router.post("/forecast")
async def generate_forecast(
    period: str = Query("quarter", json_schema_extra={"enum": ["month", "quarter", "year"]}),
    type: str = Query("cash_flow", json_schema_extra={"enum": ["cash_flow", "revenue", "expenses"]}),
    ctx: WorkspaceContext = Depends(validate_workspace),
    db: Session = Depends(get_db),
):
    """
    Generate financial forecast using AI/ML models
    
    This would use:
    - Historical data analysis
    - Time series forecasting (ARIMA, Prophet)
    - Amazon Nova for insights
    """
    
    require_workspace_level(db, ctx, "write")
    # Generate mock forecast data
    base_value = 328000 if type == "revenue" else 234000
    forecast_periods = {
        "month": 1,
        "quarter": 3,
        "year": 12
    }
    
    periods = forecast_periods[period]
    forecast_data = []
    
    for i in range(periods):
        # Simulate trend
        growth_rate = random.uniform(0.02, 0.08)
        value = base_value * (1 + growth_rate * (i + 1))
        
        forecast_data.append({
            "period": i + 1,
            "value": round(value, 2),
            "lower_bound": round(value * 0.9, 2),
            "upper_bound": round(value * 1.1, 2),
            "confidence": random.uniform(0.75, 0.95)
        })
    
    # The figures above are random placeholders, so they are labelled as demo data and
    # are not written to agent memory, where the Command Center brief would present them
    # as a real forecast. Ledger-based projections live in /api/ai-cfo (forecast_impact).
    return {
        "success": True,
        "demo": True,
        "data_notice": "Illustrative demo figures generated at random, not a forecast of your ledger.",
        "forecast_type": type,
        "period": period,
        "data": forecast_data,
        "overall_confidence": 0.85,
        "trend": "increasing" if type == "revenue" else "stable",
        "generated_at": datetime.now().isoformat()
    }

@router.get("/metrics")
async def get_key_metrics():
    """Key metrics require a live data source — never return fabricated figures."""
    raise HTTPException(status_code=501, detail=_NO_LIVE_DATA_DETAIL)

@router.post("/chat")
async def cfo_ai_chat(query: str):
    """CFO chat requires a ledger-backed assistant — never invent monetary answers."""
    raise HTTPException(status_code=501, detail=_NO_LIVE_DATA_DETAIL)

@router.post("/upload/trial-balance")
async def upload_trial_balance(file: UploadFile = File(...)):
    """
    Upload Trial Balance (CSV or Excel) to calculate CFO dashboard metrics
    
    Accepts: CSV, XLSX, XLS files
    Returns: Calculated dashboard metrics
    
    Expected columns:
    - Account Code (or Account_Code)
    - Account Name (or Account_Name)
    - Account Type (or Account_Type): Asset, Liability, Equity, Revenue, Expense
    - Debit
    - Credit
    """
    
    try:
        content = await file.read()
        temp_path = _private_copy(content, file.filename)
        try:
            from app.core.aws_config import upload_to_s3
            upload_to_s3(content, file.filename, folder="trial-balance", country="UAE")
        except Exception:
            pass  # S3 save is non-critical — processing continues from memory

        # Calculate metrics from uploaded trial balance
        parser = TrialBalanceParser(temp_path)
        metrics = parser.calculate_dashboard_metrics()

        os.remove(temp_path)
        
        return {
            "success": True,
            "message": f"Successfully processed Trial Balance: {file.filename}",
            "data": metrics,
            "file_type": "trial_balance"
        }
    
    except Exception as e:
        # Clean up temp file if it exists
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)
        
        raise HTTPException(status_code=400, detail=f"Error processing Trial Balance: {str(e)}")

@router.post("/upload/journal-entries")
async def upload_journal_entries(file: UploadFile = File(...)):
    """
    Upload journal entries (CSV or Excel) to calculate CFO dashboard metrics
    
    Accepts: CSV, XLSX, XLS files
    Returns: Calculated dashboard metrics
    """
    
    try:
        content = await file.read()
        temp_path = _private_copy(content, file.filename)
        try:
            from app.core.aws_config import upload_to_s3
            upload_to_s3(content, file.filename, folder="trial-balance", country="UAE")
        except Exception:
            pass  # S3 save is non-critical — processing continues from memory

        # Calculate metrics from uploaded file
        calculator = CFOMetricsCalculator(temp_path)
        metrics = calculator.calculate_all_metrics(time_range="month")
        
        # Clean up temp file
        os.remove(temp_path)
        
        return {
            "success": True,
            "message": f"Successfully processed {file.filename}",
            "data": metrics,
            "file_type": "journal_entries"
        }
    
    except Exception as e:
        # Clean up temp file if it exists
        if 'temp_path' in locals() and os.path.exists(temp_path):
            os.remove(temp_path)
        
        raise HTTPException(status_code=400, detail=f"Error processing file: {str(e)}")

@router.post("/upload/financial-summary")
async def upload_financial_summary(file: UploadFile = File(...)):
    """
    Upload financial summary (JSON, CSV, or Excel)
    
    Expected format:
    - JSON: Complete dashboard data structure
    - CSV/Excel: Financial summary with columns: metric, value, date
    """
    
    try:
        content = await file.read()
        try:
            from app.core.aws_config import upload_to_s3
            upload_to_s3(content, file.filename, folder="trial-balance", country="UAE")
        except Exception:
            pass  # S3 save is non-critical — processing continues from memory

        if file.filename.endswith('.json'):
            # Parse JSON directly
            data = json.loads(content)
            return {
                "success": True,
                "message": "Financial summary uploaded successfully",
                "data": data
            }
        
        elif file.filename.endswith(('.csv', '.xlsx', '.xls')):
            temp_path = _private_copy(content, file.filename)

            # Read with pandas
            if file.filename.endswith('.csv'):
                df = pd.read_csv(temp_path)
            else:
                df = pd.read_excel(temp_path)
            
            # Convert to dashboard format
            # Expected columns: metric, value, date
            dashboard_data = _convert_summary_to_dashboard(df)
            
            os.remove(temp_path)
            
            return {
                "success": True,
                "message": "Financial summary processed successfully",
                "data": dashboard_data
            }
        
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Use JSON, CSV, or Excel")
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error processing file: {str(e)}")

@router.post("/connect/accounting-software")
async def connect_accounting_software(
    platform: str = Query(..., json_schema_extra={"enum": ["quickbooks", "xero"]}),
    access_token: str = Query(...),
    company_id: Optional[str] = Query(None),
    _admin: WorkspaceContext = Depends(platform_admin),
):
    """
    Connect to accounting software (QuickBooks, Xero, etc.)
    
    Parameters:
    - platform: "quickbooks" or "xero"
    - access_token: OAuth access token
    - company_id: Company/Tenant ID (required for QuickBooks)
    """
    
    try:
        # Set environment variables for the integration
        if platform == "quickbooks":
            os.environ["QUICKBOOKS_ACCESS_TOKEN"] = access_token
            os.environ["QUICKBOOKS_COMPANY_ID"] = company_id or ""
        elif platform == "xero":
            os.environ["XERO_ACCESS_TOKEN"] = access_token
            os.environ["XERO_TENANT_ID"] = company_id or ""
        
        # Get integration
        integration = AccountingIntegrationFactory.get_integration(platform)
        
        # Fetch data
        dashboard_data = integration.get_dashboard_data(time_range="month")
        
        return {
            "success": True,
            "message": f"Successfully connected to {platform.title()}",
            "data": dashboard_data
        }
    
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Connection failed: {str(e)}")

@router.get("/data-sources")
async def get_available_data_sources():
    """
    Get list of available data sources and their status
    """
    
    sources = []
    
    # Check journal entries file
    if os.path.exists(JOURNAL_ENTRIES_PATH):
        sources.append({
            "type": "journal_entries",
            "name": "Journal Entries CSV",
            "status": "connected",
            "file": JOURNAL_ENTRIES_PATH,
            "last_updated": datetime.fromtimestamp(os.path.getmtime(JOURNAL_ENTRIES_PATH)).isoformat()
        })
    
    # Check QuickBooks connection
    if os.getenv("QUICKBOOKS_ACCESS_TOKEN"):
        sources.append({
            "type": "quickbooks",
            "name": "QuickBooks Online",
            "status": "connected",
            "company_id": os.getenv("QUICKBOOKS_COMPANY_ID")
        })
    
    # Check Xero connection
    if os.getenv("XERO_ACCESS_TOKEN"):
        sources.append({
            "type": "xero",
            "name": "Xero",
            "status": "connected",
            "tenant_id": os.getenv("XERO_TENANT_ID")
        })
    
    return {
        "sources": sources,
        "primary_source": sources[0]["type"] if sources else None,
        "data_notice": (
            None
            if sources
            else "No connected data source. Fabricated demo metrics are disabled."
        ),
    }

def _convert_summary_to_dashboard(df: pd.DataFrame) -> Dict[str, Any]:
    """Convert financial summary DataFrame to dashboard format"""
    
    # This is a helper function to convert uploaded CSV/Excel to dashboard format
    # Expected columns: metric, value, date (optional)
    
    dashboard_data = {
        "healthScore": {"overall": 0, "trend": 0, "breakdown": {}},
        "cash": {"current": 0, "trend": 0, "runway": 0, "history": []},
        "revenue": {"monthly": 0, "arr": 0, "growth": 0, "history": []},
        "expenses": {"monthly": 0, "trend": 0, "categories": []},
        "insights": [],
        "alerts": [],
        "recentActivity": [],
        "recommendations": [],
        "ratios": {}
    }
    
    # Parse DataFrame and populate dashboard_data
    for _, row in df.iterrows():
        metric = row.get('metric', '').lower()
        value = row.get('value', 0)
        
        if 'cash' in metric:
            dashboard_data['cash']['current'] = float(value)
        elif 'revenue' in metric:
            dashboard_data['revenue']['monthly'] = float(value)
        elif 'expense' in metric:
            dashboard_data['expenses']['monthly'] = float(value)
    
    return dashboard_data
