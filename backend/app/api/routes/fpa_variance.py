"""
FP&A Variance Analysis API — Budget vs Actual intelligence.
Endpoints: upload, calculate, template, ai-narrative, download-report.
"""
from fastapi import APIRouter, UploadFile, File, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional, Any, Dict
import pandas as pd
import io
import re
import json
from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, Border, Side

from app.services.nova_service import nova_service

router = APIRouter(prefix="/api/fpa/variance", tags=["FP&A Variance"])


# ---------- Request/Response models ----------

class LineItem(BaseModel):
    account: str
    department: str
    budget: float
    actual: float


class VarianceLineItem(LineItem):
    variance: float
    variance_pct: float
    status: str  # On Track | Watch | Over Budget | Under Budget
    material: bool  # >10%


class DepartmentSummary(BaseModel):
    department: str
    budget: float
    actual: float
    variance: float
    variance_pct: float
    status: str


class UploadResponse(BaseModel):
    line_items: List[Dict[str, Any]]
    departments: List[str]
    summary_stats: Dict[str, Any]
    format_detected: str


class CalculateResponse(BaseModel):
    line_items: List[Dict[str, Any]]
    department_summary: List[Dict[str, Any]]
    total_budget: float
    total_actual: float
    total_variance: float
    total_variance_pct: float
    overall_status: str


class AINarrativeResponse(BaseModel):
    executive_summary: str
    line_commentary: List[Dict[str, str]]  # [{ account, why, recommendation }]
    action_items: List[str]


def _parse_num(val: Any) -> float:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return 0.0
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).replace(",", "").replace("₹", "").replace("$", "").strip()
    if not s:
        return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def _detect_and_normalize(df: pd.DataFrame) -> tuple[List[Dict], str]:
    """Detect format A, B, or C and return list of { account, department, budget, actual }."""
    cols = [c.strip() for c in df.columns.astype(str)]
    col_lower = [c.lower() for c in cols]

    # Format A: Account | Department | Budget | Actual
    if any("budget" in c and "actual" in c for c in col_lower):
        pass  # might be Format B
    elif "budget" in " ".join(col_lower) and "actual" in " ".join(col_lower):
        acc_col = next((c for c in cols if "account" in c.lower() or "category" in c.lower() or "line" in c.lower()), cols[0])
        dept_col = next((c for c in cols if "department" in c.lower() or "dept" in c.lower()), None)
        budget_col = next((c for c in cols if ("budget" in c.lower() and "actual" not in c.lower()) or c.lower() == "budget"), None)
        actual_col = next((c for c in cols if ("actual" in c.lower() and "budget" not in c.lower()) or c.lower() == "actual"), None)
        if budget_col and actual_col:
            out = []
            for _, row in df.iterrows():
                budget = _parse_num(row.get(budget_col, 0))
                actual = _parse_num(row.get(actual_col, 0))
                if budget == 0 and actual == 0:
                    continue
                out.append({
                    "account": str(row.get(acc_col, "")).strip() or "Unnamed",
                    "department": str(row.get(dept_col, "")).strip() if dept_col else "All Depts",
                    "budget": budget,
                    "actual": actual,
                })
            return out, "A"

    # Format B: Jan_Budget, Jan_Actual, Feb_Budget, ...
    budget_cols = [c for c in cols if "budget" in c.lower() and "actual" not in c.lower()]
    actual_cols = [c for c in cols if "actual" in c.lower()]
    if budget_cols and actual_cols:
        acc_col = next((c for c in cols if "account" in c.lower() or "category" in c.lower()), cols[0])
        dept_col = next((c for c in cols if "department" in c.lower()), None)
        # Sum all periods
        out = []
        for _, row in df.iterrows():
            budget = sum(_parse_num(row.get(c, 0)) for c in budget_cols)
            actual = sum(_parse_num(row.get(c, 0)) for c in actual_cols)
            if budget == 0 and actual == 0:
                continue
            out.append({
                "account": str(row.get(acc_col, "")).strip() or "Unnamed",
                "department": str(row.get(dept_col, "")).strip() if dept_col else "All Depts",
                "budget": budget,
                "actual": actual,
            })
        return out, "B"

    # Format C: Account | Department | Period | Type (Budget/Actual) | Amount
    if "type" in " ".join(col_lower) and "amount" in " ".join(col_lower):
        acc_col = next((c for c in cols if "account" in c.lower()), cols[0])
        dept_col = next((c for c in cols if "department" in c.lower()), None)
        type_col = next((c for c in cols if "type" in c.lower()), None)
        amt_col = next((c for c in cols if "amount" in c.lower()), None)
        if type_col and amt_col:
            by_key: Dict[tuple, Dict] = {}
            for _, row in df.iterrows():
                key = (str(row.get(acc_col, "")).strip(), str(row.get(dept_col, "")).strip() if dept_col else "All Depts")
                if key not in by_key:
                    by_key[key] = {"account": key[0], "department": key[1], "budget": 0.0, "actual": 0.0}
                t = str(row.get(type_col, "")).lower()
                amt = _parse_num(row.get(amt_col, 0))
                if "budget" in t:
                    by_key[key]["budget"] += amt
                elif "actual" in t:
                    by_key[key]["actual"] += amt
            out = [v for v in by_key.values() if v["budget"] != 0 or v["actual"] != 0]
            return out, "C"

    # Fallback: try common column names
    acc_col = next((c for c in cols if "account" in c.lower() or "category" in c.lower() or "name" in c.lower()), cols[0])
    dept_col = next((c for c in cols if "department" in c.lower() or "dept" in c.lower()), None)
    for b in ["budget", "Budget", "Budget_Amount", "budget_amount"]:
        if b in cols:
            for a in ["actual", "Actual", "Actual_Amount", "actual_amount"]:
                if a in cols:
                    out = []
                    for _, row in df.iterrows():
                        budget = _parse_num(row.get(b, 0))
                        actual = _parse_num(row.get(a, 0))
                        if budget == 0 and actual == 0:
                            continue
                        out.append({
                            "account": str(row.get(acc_col, "")).strip() or "Unnamed",
                            "department": str(row.get(dept_col, "")).strip() if dept_col else "All Depts",
                            "budget": budget,
                            "actual": actual,
                        })
                    return out, "A"

    raise HTTPException(status_code=400, detail="Could not detect Excel/CSV format. Use columns: Account, Department, Budget, Actual (or Budget_Amount, Actual_Amount).")


def _status(variance_pct: float) -> str:
    if abs(variance_pct) < 5:
        return "On Track"
    if variance_pct > 10:
        return "Over Budget"
    if variance_pct < -10:
        return "Under Budget"
    return "Watch"


def _calculate(line_items: List[Dict]) -> Dict:
    total_budget = sum(i["budget"] for i in line_items)
    total_actual = sum(i["actual"] for i in line_items)
    total_variance = total_actual - total_budget
    total_variance_pct = (total_variance / total_budget * 100) if total_budget else 0

    computed = []
    for i in line_items:
        b, a = i["budget"], i["actual"]
        var = a - b
        var_pct = (var / b * 100) if b else 0
        computed.append({
            **i,
            "variance": var,
            "variance_pct": var_pct,
            "status": _status(var_pct),
            "material": abs(var_pct) > 10,
        })

    # Department summary
    dept_agg: Dict[str, Dict] = {}
    for i in computed:
        d = i["department"]
        if d not in dept_agg:
            dept_agg[d] = {"department": d, "budget": 0, "actual": 0, "variance": 0}
        dept_agg[d]["budget"] += i["budget"]
        dept_agg[d]["actual"] += i["actual"]
        dept_agg[d]["variance"] += i["variance"]
    dept_list = []
    for d, v in dept_agg.items():
        vpct = (v["variance"] / v["budget"] * 100) if v["budget"] else 0
        dept_list.append({
            **v,
            "variance_pct": vpct,
            "status": _status(vpct),
        })

    return {
        "line_items": computed,
        "department_summary": dept_list,
        "total_budget": total_budget,
        "total_actual": total_actual,
        "total_variance": total_variance,
        "total_variance_pct": total_variance_pct,
        "overall_status": _status(total_variance_pct),
    }


@router.post("/upload", response_model=UploadResponse)
async def upload_variance(file: UploadFile = File(...)):
    """Accept Excel or CSV; auto-detect format (A, B, or C); normalise and return line_items, departments, summary_stats."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file")
    ext = file.filename.lower().split(".")[-1]
    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, .csv allowed")

    contents = await file.read()
    try:
        if ext == "csv":
            df = pd.read_csv(io.StringIO(contents.decode("utf-8")))
        else:
            df = pd.read_excel(io.BytesIO(contents), engine="openpyxl")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    if df.empty or len(df.columns) < 2:
        raise HTTPException(status_code=400, detail="File has no data or too few columns")

    line_items, fmt = _detect_and_normalize(df)
    if not line_items:
        raise HTTPException(status_code=400, detail="No valid rows found. Check column names: Account, Department, Budget, Actual.")

    departments = list({i["department"] for i in line_items})
    calc = _calculate(line_items)
    summary_stats = {
        "total_budget": calc["total_budget"],
        "total_actual": calc["total_actual"],
        "total_variance": calc["total_variance"],
        "total_variance_pct": calc["total_variance_pct"],
        "line_count": len(line_items),
        "department_count": len(departments),
    }
    return UploadResponse(
        line_items=calc["line_items"],
        departments=departments,
        summary_stats=summary_stats,
        format_detected=fmt,
    )


class CalculateRequest(BaseModel):
    line_items: List[Dict[str, Any]]


@router.post("/calculate", response_model=CalculateResponse)
async def calculate_variance(body: CalculateRequest):
    """Compute variance ₹, %, status, materiality, department totals."""
    if not body.line_items:
        raise HTTPException(status_code=400, detail="line_items required")
    normalized = []
    for i in body.line_items:
        normalized.append({
            "account": str(i.get("account", "")),
            "department": str(i.get("department", "All Depts")),
            "budget": _parse_num(i.get("budget", 0)),
            "actual": _parse_num(i.get("actual", 0)),
        })
    result = _calculate(normalized)
    return CalculateResponse(**result)


@router.get("/template")
async def get_variance_template():
    """Return downloadable Excel template with sample data and Instructions sheet."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Variance Data"
    headers = ["Account_Name", "Department", "Budget_Amount", "Actual_Amount", "Notes"]
    sample = [
        ["Marketing", "Marketing Dept", 2300000, 2720000, "Campaign costs"],
        ["IT Infrastructure", "Technology", 1800000, 2016000, "Cloud migration"],
        ["Travel & Expenses", "All Depts", 680000, 530000, "Remote work"],
        ["Salaries & Wages", "All Depts", 8500000, 8500000, "On plan"],
        ["Office Rent", "Admin", 1200000, 1200000, "Fixed"],
        ["Training & Dev", "HR", 600000, 510000, "Online shift"],
        ["Legal & Compliance", "Finance", 450000, 423000, "Under retainer"],
        ["Sales Commissions", "Sales", 1100000, 1320000, "Over target"],
        ["Customer Support", "Operations", 920000, 875000, "Efficiency gain"],
        ["R&D Expenses", "Technology", 2200000, 2310000, "New hire"],
        ["Advertising", "Marketing", 850000, 940000, ""],
        ["Software Licenses", "Technology", 420000, 398000, ""],
        ["Recruitment", "HR", 380000, 510000, ""],
        ["Insurance", "Finance", 290000, 290000, ""],
        ["Utilities", "Admin", 180000, 162000, ""],
        ["Maintenance", "Operations", 240000, 228000, ""],
        ["Professional Fees", "Finance", 620000, 698000, ""],
        ["Depreciation", "Finance", 1100000, 1100000, ""],
        ["Interest Expense", "Finance", 340000, 325000, ""],
        ["Printing & Stationery", "Admin", 45000, 38000, ""],
        ["Telephone & Internet", "Admin", 120000, 114000, ""],
        ["Bank Charges", "Finance", 28000, 31000, ""],
        ["Event & Conferences", "Marketing", 350000, 420000, ""],
        ["Security Services", "Admin", 160000, 155000, ""],
    ]
    for c, h in enumerate(headers, 1):
        ws.cell(row=1, column=c, value=h)
    for r, row in enumerate(sample, 2):
        for c, val in enumerate(row, 1):
            ws.cell(row=r, column=c, value=val)

    inst = wb.create_sheet("Instructions")
    inst["A1"] = "How to fill the Variance Data template"
    inst["A2"] = "1. Sheet 'Variance Data' must have columns: Account_Name, Department, Budget_Amount, Actual_Amount (Notes optional)."
    inst["A3"] = "2. You can use Format A: Account | Department | Budget | Actual"
    inst["A4"] = "3. Or period columns: Jan_Budget, Jan_Actual, Feb_Budget, Feb_Actual, etc."
    inst["A5"] = "4. Or long format: Account | Department | Period | Type (Budget/Actual) | Amount"
    inst["A6"] = "5. Upload your file in the Variance Analysis module; format is auto-detected."

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=FP&A_Variance_Template.xlsx"},
    )


class AINarrativeRequest(BaseModel):
    variance_analysis: Dict[str, Any]  # full object from calculate


@router.post("/ai-narrative", response_model=AINarrativeResponse)
async def generate_ai_narrative(body: AINarrativeRequest):
    """Call AWS Nova to produce executive summary, line commentary, and action items."""
    va = body.variance_analysis
    line_items = va.get("line_items") or []
    dept_summary = va.get("department_summary") or []
    total_budget = va.get("total_budget", 0)
    total_actual = va.get("total_actual", 0)
    total_variance = va.get("total_variance", 0)
    total_variance_pct = va.get("total_variance_pct", 0)

    material = [i for i in line_items if i.get("material") or abs(i.get("variance_pct", 0)) > 10]
    material_text = "\n".join(
        f"- {i.get('account', '')} ({i.get('department', '')}): Budget {i.get('budget', 0):,.0f}, Actual {i.get('actual', 0):,.0f}, Variance {i.get('variance', 0):,.0f} ({i.get('variance_pct', 0):.1f}%)"
        for i in material[:15]
    )
    dept_text = "\n".join(
        f"- {d.get('department', '')}: Budget {d.get('budget', 0):,.0f}, Actual {d.get('actual', 0):,.0f}, Variance {d.get('variance_pct', 0):.1f}%"
        for d in dept_summary
    )

    prompt = f"""You are a CFO advisor. Analyse these budget variances and provide:

1) EXECUTIVE SUMMARY: One paragraph (3-5 sentences) for the board. State: "Overall the company spent ₹X against a budget of ₹Y, resulting in a ₹Z unfavorable/favorable variance (X%)." Name the primary drivers (top 2-3). Say what needs immediate attention and one positive note on savings. Be specific with numbers. Use Indian number style (e.g. ₹1,20,00,000).

2) LINE BY LINE COMMENTARY: For each material variance listed below, give:
   - WHY: One sentence on likely cause.
   - RECOMMENDATION: One sentence on what the CFO should do.
Format each as: "Account Name — WHY: ... RECOMMENDATION: ..."

3) ACTION ITEMS: Exactly 3-5 numbered action items. Mix: URGENT (investigate overspend), MONITOR (watch trend), OPTIMISE (reallocate savings). Format: "1. 🔴 URGENT: ..." or "2. 🟡 MONITOR: ..." or "3. 🟢 OPTIMISE: ..."

DATA:
Total Budget: ₹{total_budget:,.0f}
Total Actual: ₹{total_actual:,.0f}
Total Variance: ₹{total_variance:,.0f} ({total_variance_pct:+.1f}%)

Material line items:
{material_text}

Department summary:
{dept_text}

Output in this exact structure (so we can parse):
---EXECUTIVE_SUMMARY---
(one paragraph)
---LINE_COMMENTARY---
(one block per material item: "Account — WHY: ... RECOMMENDATION: ...")
---ACTION_ITEMS---
(one numbered item per line)
"""

    try:
        text = nova_service.invoke(prompt=prompt, max_tokens=2000, temperature=0.3)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Nova AI failed: {str(e)}")

    executive_summary = ""
    line_commentary: List[Dict[str, str]] = []
    action_items: List[str] = []

    if "---EXECUTIVE_SUMMARY---" in text:
        parts = text.split("---EXECUTIVE_SUMMARY---", 1)[1]
        if "---LINE_COMMENTARY---" in parts:
            exec_part, rest = parts.split("---LINE_COMMENTARY---", 1)
            executive_summary = exec_part.strip()
            if "---ACTION_ITEMS---" in rest:
                comm_part, act_part = rest.split("---ACTION_ITEMS---", 1)
                for line in comm_part.strip().split("\n"):
                    line = line.strip()
                    if not line:
                        continue
                    if " — WHY:" in line or " - WHY:" in line:
                        sep = " — WHY:" if " — WHY:" in line else " - WHY:"
                        a, b = line.split(sep, 1)
                        account = a.strip().strip("- ")
                        if "RECOMMENDATION:" in b:
                            why, rec = b.split("RECOMMENDATION:", 1)
                            line_commentary.append({
                                "account": account,
                                "why": why.replace("WHY:", "").strip(),
                                "recommendation": rec.strip(),
                            })
                        else:
                            line_commentary.append({"account": account, "why": b.strip(), "recommendation": ""})
                for line in act_part.strip().split("\n"):
                    line = line.strip()
                    if line and (line[0].isdigit() or line.startswith("🔴") or line.startswith("🟡") or line.startswith("🟢")):
                        action_items.append(line)
        else:
            executive_summary = parts.strip()[:2000]
    else:
        executive_summary = text.strip()[:2000]

    if not executive_summary:
        executive_summary = text.strip()[:1500]

    return AINarrativeResponse(
        executive_summary=executive_summary,
        line_commentary=line_commentary,
        action_items=action_items,
    )


class DownloadReportRequest(BaseModel):
    variance_analysis: Dict[str, Any]
    ai_narrative: Optional[Dict[str, Any]] = None


@router.post("/download-report")
async def download_report(body: DownloadReportRequest):
    """Generate Excel report: Executive Summary, Full Variance Table, Department Summary, AI Narrative."""
    va = body.variance_analysis
    ai = body.ai_narrative or {}
    line_items = va.get("line_items") or []
    dept_summary = va.get("department_summary") or []

    wb = Workbook()
    thin = Side(style="thin")
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    # Sheet 1: Executive Summary
    ws1 = wb.active
    ws1.title = "Executive Summary"
    ws1["A1"] = "Variance Analysis Report — Executive Summary"
    ws1["A1"].font = Font(bold=True, size=14)
    ws1["A2"] = f"Generated: {pd.Timestamp.now().strftime('%Y-%m-%d %H:%M')}"
    row = 4
    if ai.get("executive_summary"):
        ws1[f"A{row}"] = ai["executive_summary"]
        ws1[f"A{row}"].alignment = Alignment(wrap_text=True)
        row += 4
    ws1[f"A{row}"] = "Key metrics"
    row += 1
    ws1[f"A{row}"] = f"Total Budget: {va.get('total_budget', 0):,.0f}"
    ws1[f"B{row}"] = f"Total Actual: {va.get('total_actual', 0):,.0f}"
    row += 1
    ws1[f"A{row}"] = f"Total Variance: {va.get('total_variance', 0):,.0f} ({va.get('total_variance_pct', 0):.1f}%)"
    row += 2
    if ai.get("action_items"):
        ws1[f"A{row}"] = "Action Items"
        row += 1
        for item in ai["action_items"]:
            ws1[f"A{row}"] = item
            row += 1

    # Sheet 2: Full Variance Table
    ws2 = wb.create_sheet("Full Variance Table")
    ws2.append(["Account", "Department", "Budget", "Actual", "Variance", "Variance %", "Status"])
    for i in line_items:
        ws2.append([
            i.get("account", ""),
            i.get("department", ""),
            i.get("budget", 0),
            i.get("actual", 0),
            i.get("variance", 0),
            f"{i.get('variance_pct', 0):.1f}%",
            i.get("status", ""),
        ])

    # Sheet 3: Department Summary
    ws3 = wb.create_sheet("Department Summary")
    ws3.append(["Department", "Budget", "Actual", "Variance", "Variance %", "Status"])
    for d in dept_summary:
        ws3.append([
            d.get("department", ""),
            d.get("budget", 0),
            d.get("actual", 0),
            d.get("variance", 0),
            f"{d.get('variance_pct', 0):.1f}%",
            d.get("status", ""),
        ])

    # Sheet 4: AI Narrative
    ws4 = wb.create_sheet("AI Narrative")
    ws4["A1"] = "Executive Summary"
    ws4["A1"].font = Font(bold=True)
    ws4["A2"] = ai.get("executive_summary", "")
    ws4["A2"].alignment = Alignment(wrap_text=True)
    r = 4
    if ai.get("line_commentary"):
        ws4[f"A{r}"] = "Line commentary"
        ws4[f"A{r}"].font = Font(bold=True)
        r += 1
        for c in ai["line_commentary"]:
            ws4[f"A{r}"] = c.get("account", "")
            ws4[f"B{r}"] = f"WHY: {c.get('why', '')} RECOMMENDATION: {c.get('recommendation', '')}"
            r += 1
        r += 1
    if ai.get("action_items"):
        ws4[f"A{r}"] = "Action Items"
        ws4[f"A{r}"].font = Font(bold=True)
        r += 1
        for item in ai["action_items"]:
            ws4[f"A{r}"] = item
            r += 1

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=Variance_Analysis_Report.xlsx"},
    )
