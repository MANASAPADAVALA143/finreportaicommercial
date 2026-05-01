"""IFRS 15 revenue recognition reconciliation — POST endpoints under /api/rev-rec."""
import asyncio
import glob
import json
import os
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.services import llm_service

router = APIRouter(prefix="/api/rev-rec", tags=["Rev Rec Reconciliation"])


async def call_nova(prompt: str, max_tokens: int = 600, temperature: float = 0.25) -> str:
    """Invoke configured LLM (same stack as other FinReportAI routes; no separate nova_service in repo)."""

    def _run() -> str:
        return llm_service.invoke(prompt=prompt, max_tokens=max_tokens, temperature=temperature)

    try:
        return await asyncio.to_thread(_run)
    except Exception:
        return "AI commentary unavailable for this request."


class ContractRevSchedule(BaseModel):
    contract_id: str
    customer_name: str
    start_date: str
    end_date: str
    total_value: float
    monthly_amount: float
    performance_obligation: str
    recognition_type: str  # over_time | point_in_time


class BillingRecord(BaseModel):
    contract_id: str
    customer_name: str
    arr: float
    mrr: float
    billing_date: str
    billing_system: str  # salesforce | zuora | sap


class DebitCreditEntry(BaseModel):
    period: str
    account_code: str
    description: str
    debit: float
    credit: float
    posted_by: str
    posted_date: str
    contract_id: Optional[str] = None


class DeferredRevenueRollForwardRequest(BaseModel):
    period: str
    opening_balance: float
    new_billings: float
    modification_increases: float
    modification_decreases: float
    revenue_recognised: float
    cancellations: float
    fx_retranslation: float
    gl_closing_balance: float
    contract_schedules: Optional[list[ContractRevSchedule]] = Field(default_factory=list)


class ThreeWayMatchRequest(BaseModel):
    period: str
    billing_records: list[BillingRecord]
    gl_revenue_entries: list[DebitCreditEntry]
    contract_schedules: list[ContractRevSchedule]


class AnomalyDetectionRequest(BaseModel):
    period: str
    revenue_entries: list[DebitCreditEntry]
    threshold_amount: float = 10000


class RPOMovementRequest(BaseModel):
    period: str
    opening_rpo: float
    new_contracts_value: float
    modifications_net: float
    revenue_recognised: float
    cancellations: float
    closing_rpo_per_disclosure: float


class CommissionReconRequest(BaseModel):
    period: str
    opening_asset: float
    new_commissions_capitalised: float
    monthly_amortisation: float
    gl_closing_balance: float


class CommentaryRequest(BaseModel):
    period: str
    reconciliation_type: str
    reconciling_items: list[dict]
    prior_period_items: list[dict] = Field(default_factory=list)
    risk_level: str


class PeriodCloseSummaryRequest(BaseModel):
    period: str
    roll_forward_result: Optional[dict] = None
    three_way_match_result: Optional[dict] = None
    anomaly_result: Optional[dict] = None
    rpo_result: Optional[dict] = None
    commission_result: Optional[dict] = None


class PeriodClosePackRequest(BaseModel):
    period: str
    customer_name: Optional[str] = None
    roll_forward_result: Optional[dict] = None
    three_way_match_result: Optional[dict] = None
    anomaly_result: Optional[dict] = None
    rpo_result: Optional[dict] = None
    commission_result: Optional[dict] = None
    period_close_result: Optional[dict] = None


def _parse_posted_hour(posted_date: str) -> Optional[int]:
    if not posted_date:
        return None
    s = posted_date.strip().replace("Z", "+00:00")
    for candidate in (s, s.replace(" ", "T")):
        try:
            return datetime.fromisoformat(candidate).hour
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).hour
        except ValueError:
            continue
    return None


@router.post("/roll-forward")
async def roll_forward(request: DeferredRevenueRollForwardRequest):
    expected_closing = (
        request.opening_balance
        + request.new_billings
        + request.modification_increases
        - request.modification_decreases
        - request.revenue_recognised
        - request.cancellations
        + request.fx_retranslation
    )

    difference = round(expected_closing - request.gl_closing_balance, 2)
    reconciled = abs(difference) < 1.0

    risk_level = (
        "high"
        if abs(difference) > 10000
        else "medium" if abs(difference) > 1000 else "low"
    )

    roll_forward_lines = [
        {"label": "Opening Balance", "amount": request.opening_balance, "direction": "opening"},
        {"label": "New Billings (cash received in advance)", "amount": request.new_billings, "direction": "add"},
        {"label": "Modification Increases", "amount": request.modification_increases, "direction": "add"},
        {"label": "Modification Decreases", "amount": -request.modification_decreases, "direction": "subtract"},
        {"label": "Revenue Recognised", "amount": -request.revenue_recognised, "direction": "subtract"},
        {"label": "Cancellations / Churn", "amount": -request.cancellations, "direction": "subtract"},
        {"label": "FX Retranslation", "amount": request.fx_retranslation, "direction": "adjust"},
        {"label": "Expected Closing Balance", "amount": round(expected_closing, 2), "direction": "total"},
        {"label": "GL Closing Balance", "amount": request.gl_closing_balance, "direction": "gl"},
        {"label": "Difference", "amount": difference, "direction": "difference"},
    ]

    nova_prompt = f"""
You are an IFRS 15 revenue reconciliation expert.
Period: {request.period}

Deferred revenue roll-forward:
Opening balance: ${request.opening_balance:,.0f}
New billings: ${request.new_billings:,.0f}
Revenue recognised: ${request.revenue_recognised:,.0f}
Cancellations: ${request.cancellations:,.0f}
FX retranslation: ${request.fx_retranslation:,.0f}
Expected closing: ${expected_closing:,.0f}
GL closing balance: ${request.gl_closing_balance:,.0f}
Difference: ${difference:,.0f}
Reconciled: {reconciled}

Write 2 sentences:
Sentence 1: Summarise the period movement and whether the roll-forward reconciles.
Sentence 2: If difference exists explain the most likely cause and recommended action.
If reconciled say this is clean.
Use plain English. Use actual numbers.
"""

    nova_commentary = await call_nova(nova_prompt)

    return {
        "period": request.period,
        "roll_forward_lines": roll_forward_lines,
        "expected_closing": round(expected_closing, 2),
        "gl_closing_balance": request.gl_closing_balance,
        "difference": difference,
        "reconciled": reconciled,
        "risk_level": risk_level,
        "nova_commentary": nova_commentary,
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/three-way-match")
async def three_way_match(request: ThreeWayMatchRequest):
    results = []
    billing_map = {r.contract_id: r for r in request.billing_records}
    gl_map: dict[str, float] = {}
    for e in request.gl_revenue_entries:
        if e.contract_id:
            cid = e.contract_id
            gl_map.setdefault(cid, 0.0)
            gl_map[cid] += float(e.credit or 0.0)
    schedule_map = {s.contract_id: s for s in request.contract_schedules}

    all_ids = set(billing_map.keys()) | set(gl_map.keys()) | set(schedule_map.keys())

    for contract_id in sorted(all_ids):
        billing_rec = billing_map.get(contract_id)
        billing_amount = float(billing_rec.arr) if billing_rec is not None else None
        gl_present = contract_id in gl_map
        gl_amount = gl_map[contract_id] if gl_present else None
        sched = schedule_map.get(contract_id)
        schedule_amount = float(sched.monthly_amount) if sched is not None else None

        has_billing = billing_rec is not None
        has_gl = gl_present
        has_schedule = sched is not None

        if has_billing and has_gl and has_schedule:
            if abs(billing_amount - gl_amount) < 1 and abs(gl_amount - schedule_amount) < 1:
                status = "matched"
                risk = "low"
                difference = 0.0
            elif abs(billing_amount - gl_amount) >= 1:
                status = "billing_gl_diff"
                risk = "high"
                difference = billing_amount - gl_amount
            else:
                status = "schedule_gl_diff"
                risk = "medium"
                difference = (gl_amount or 0.0) - (schedule_amount or 0.0)
        elif not has_gl:
            status = "missing_gl"
            risk = "high"
            difference = float(billing_amount if billing_amount is not None else (schedule_amount or 0.0))
        elif not has_billing:
            status = "missing_billing"
            risk = "medium"
            difference = float(gl_amount or 0.0)
        else:
            status = "missing_schedule"
            risk = "low"
            difference = 0.0

        nova_explanation = ""
        if status != "matched":
            nova_prompt = f"""
IFRS 15 three-way match exception:
Contract: {contract_id}
Billing system amount: {billing_amount}
GL revenue amount: {gl_amount}
Contract schedule amount: {schedule_amount}
Status: {status}
Difference: {difference}

One sentence explanation of most likely cause. One sentence recommended action.
"""
            nova_explanation = await call_nova(nova_prompt)

        customer = (
            billing_rec.customer_name
            if billing_rec is not None
            else (sched.customer_name if sched is not None else "Unknown")
        )

        results.append(
            {
                "contract_id": contract_id,
                "customer": customer,
                "billing_amount": billing_amount,
                "gl_amount": gl_amount,
                "schedule_amount": schedule_amount,
                "status": status,
                "difference": difference,
                "risk": risk,
                "nova_explanation": nova_explanation,
            }
        )

    matched = [r for r in results if r["status"] == "matched"]
    unmatched = [r for r in results if r["status"] != "matched"]
    match_rate = (len(matched) / len(results) * 100) if results else 0.0

    nova_summary_prompt = f"""
IFRS 15 three-way match summary for {request.period}:
Total contracts: {len(results)}
Matched: {len(matched)}
Unmatched: {len(unmatched)}
Match rate: {match_rate:.1f}%

Write one paragraph summarising the match results and top risk items. Plain English.
"""
    nova_summary = await call_nova(nova_summary_prompt)

    return {
        "period": request.period,
        "total_contracts": len(results),
        "matched": len(matched),
        "unmatched": len(unmatched),
        "match_rate_pct": round(match_rate, 1),
        "matched_amount": sum((r["billing_amount"] or 0) for r in matched),
        "unmatched_amount": sum(abs(r["difference"] or 0) for r in unmatched),
        "items": results,
        "high_risk_count": len([r for r in results if r["risk"] == "high"]),
        "nova_summary": nova_summary,
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/anomaly-detection")
async def anomaly_detection(request: AnomalyDetectionRequest):
    flags = []

    amounts = [
        abs(e.debit - e.credit) for e in request.revenue_entries if (e.debit - e.credit) != 0
    ]

    first_digits = [int(str(abs(a))[0]) for a in amounts if a > 0]
    benford_deviation = 0.0
    if first_digits:
        digit_1_count = first_digits.count(1)
        expected_pct = 0.301
        actual_pct = digit_1_count / len(first_digits)
        benford_deviation = abs(actual_pct - expected_pct)

    for entry in request.revenue_entries:
        amount = abs(entry.debit - entry.credit)
        entry_flags: list[str] = []

        # Round-number heuristic: skip when already "large" to avoid duplicate noise on big round postings.
        if amount > 0 and amount % 1000 == 0 and amount <= request.threshold_amount:
            entry_flags.append("Round Number")

        hour = _parse_posted_hour(entry.posted_date)
        if hour is not None and (hour < 7 or hour > 19):
            entry_flags.append("After Hours")

        if not entry.contract_id:
            entry_flags.append("No Contract Reference")

        if amount > request.threshold_amount:
            entry_flags.append("Large Amount")

        if entry_flags:
            risk_score = min(len(entry_flags) * 25, 100)
            risk = "high" if risk_score >= 75 else "medium" if risk_score >= 50 else "low"

            nova_prompt = f"""
Revenue journal entry flagged for review.
Account: {entry.account_code}
Amount: ${amount:,.0f}
Posted by: {entry.posted_by}
Posted: {entry.posted_date}
Contract: {entry.contract_id or 'NONE'}
Description: {entry.description}
Flags: {', '.join(entry_flags)}

Is this likely legitimate or suspicious?
Risk assessment in exactly 2 sentences.
"""
            nova_assessment = await call_nova(nova_prompt)

            flags.append(
                {
                    "entry": {
                        "account_code": entry.account_code,
                        "amount": amount,
                        "posted_by": entry.posted_by,
                        "posted_date": entry.posted_date,
                        "contract_id": entry.contract_id,
                        "description": entry.description,
                    },
                    "flag_types": entry_flags,
                    "risk_score": risk_score,
                    "risk": risk,
                    "nova_assessment": nova_assessment,
                    "action_required": (
                        "Escalate for controller review"
                        if risk == "high"
                        else "Review before sign-off"
                        if risk == "medium"
                        else "Note in workpaper"
                    ),
                }
            )

    total = len(request.revenue_entries)
    flagged = len(flags)
    flag_rate = (flagged / total * 100) if total else 0.0
    high_risk_flag_count = len([f for f in flags if f["risk"] == "high"])

    nova_batch_prompt = f"""
Revenue anomaly detection complete for period {request.period}.
Total entries reviewed: {total}
Flagged entries: {flagged}
Flag rate: {flag_rate:.1f}%
Benford deviation: {benford_deviation:.3f}
High risk flags: {high_risk_flag_count}

Write one paragraph summarising the anomaly results and whether the revenue journal entry population appears clean or requires escalation. Plain English. Specific.
"""
    nova_batch_summary = await call_nova(nova_batch_prompt)

    return {
        "period": request.period,
        "total_entries": total,
        "flagged_count": flagged,
        "flag_rate_pct": round(flag_rate, 1),
        "flags": flags,
        "benford_deviation": round(benford_deviation, 3),
        "high_risk_entries": high_risk_flag_count,
        "nova_batch_summary": nova_batch_summary,
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/rpo-movement")
async def rpo_movement(request: RPOMovementRequest):
    expected_closing = (
        request.opening_rpo
        + request.new_contracts_value
        + request.modifications_net
        - request.revenue_recognised
        - request.cancellations
    )
    difference = round(expected_closing - request.closing_rpo_per_disclosure, 2)
    reconciled = abs(difference) < 1.0

    nova_prompt = f"""
IFRS 15 RPO movement reconciliation.
Period: {request.period}
Opening RPO: ${request.opening_rpo:,.0f}
New contracts: ${request.new_contracts_value:,.0f}
Modifications net: ${request.modifications_net:,.0f}
Revenue recognised: ${request.revenue_recognised:,.0f}
Cancellations: ${request.cancellations:,.0f}
Expected closing RPO: ${expected_closing:,.0f}
Disclosed closing RPO: ${request.closing_rpo_per_disclosure:,.0f}
Difference: ${difference:,.0f}

Two sentences: is the RPO disclosure supported by the movement calculation?
If difference exists, what is the likely cause?
"""
    nova_commentary = await call_nova(nova_prompt)

    return {
        "period": request.period,
        "movement_lines": [
            {"label": "Opening RPO", "amount": request.opening_rpo},
            {"label": "+ New Contracts", "amount": request.new_contracts_value},
            {"label": "+ Modifications (net)", "amount": request.modifications_net},
            {"label": "- Revenue Recognised", "amount": -request.revenue_recognised},
            {"label": "- Cancellations", "amount": -request.cancellations},
            {"label": "Expected Closing RPO", "amount": round(expected_closing, 2)},
            {"label": "Disclosed Closing RPO", "amount": request.closing_rpo_per_disclosure},
            {"label": "Difference", "amount": difference},
        ],
        "expected_closing": round(expected_closing, 2),
        "disclosed_closing": request.closing_rpo_per_disclosure,
        "difference": difference,
        "reconciled": reconciled,
        "nova_commentary": nova_commentary,
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/commission-recon")
async def commission_recon(request: CommissionReconRequest):
    expected_closing = request.opening_asset + request.new_commissions_capitalised - request.monthly_amortisation
    difference = round(expected_closing - request.gl_closing_balance, 2)
    reconciled = abs(difference) < 0.01

    nova_prompt = f"""
IFRS 15 contract cost asset reconciliation.
Period: {request.period}
Opening asset: ${request.opening_asset:,.0f}
New commissions capitalised: ${request.new_commissions_capitalised:,.0f}
Monthly amortisation: ${request.monthly_amortisation:,.0f}
Expected closing: ${expected_closing:,.0f}
GL closing balance: ${request.gl_closing_balance:,.0f}
Difference: ${difference:,.2f}

One sentence on whether commission asset reconciles to GL. If difference, likely cause.
"""
    nova_commentary = await call_nova(nova_prompt)

    return {
        "period": request.period,
        "opening_asset": request.opening_asset,
        "new_commissions": request.new_commissions_capitalised,
        "amortisation": request.monthly_amortisation,
        "expected_closing": round(expected_closing, 2),
        "gl_closing_balance": request.gl_closing_balance,
        "difference": difference,
        "reconciled": reconciled,
        "nova_commentary": nova_commentary,
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/commentary")
async def generate_commentary(request: CommentaryRequest):
    if not request.reconciling_items:
        raise HTTPException(status_code=400, detail="reconciling_items cannot be empty")

    items_text = json.dumps(request.reconciling_items, indent=2)
    prior_text = json.dumps(request.prior_period_items, indent=2)

    nova_prompt = f"""
You are an IFRS 15 senior reconciliation expert at a Big 4 accounting firm.

Write audit-ready reconciliation commentary.
Period: {request.period}
Reconciliation type: {request.reconciliation_type}
Risk level: {request.risk_level}

Reconciling items:
{items_text}

Prior period items for comparison:
{prior_text}

For EACH reconciling item write exactly:
Sentence 1: What the item is and its amount.
Sentence 2: Root cause explanation.
Sentence 3: Expected resolution and timeline.

Then write one overall assessment paragraph covering period risk and any patterns vs prior period.

Style: Big 4 audit memo. Professional. Specific — use actual numbers from the data. No boilerplate phrases.
Format each item as:
ITEM: [description]
[three sentences]
"""
    full_commentary = await call_nova(nova_prompt, max_tokens=1400)

    commentary_lines = full_commentary.split("ITEM:")
    per_item = []
    for line in commentary_lines[1:]:
        parts = line.strip().split("\n", 1)
        per_item.append(
            {
                "item_description": parts[0].strip(),
                "commentary": parts[1].strip() if len(parts) > 1 else line.strip(),
            }
        )

    overall = commentary_lines[0].strip() if len(commentary_lines) > 1 else full_commentary

    risk_key = (request.risk_level or "medium").lower()
    risk_actions = {
        "high": [
            "Escalate to controller before sign-off",
            "Obtain written explanation from preparer",
            "Document in audit exception log",
        ],
        "medium": [
            "Review with preparer before certifying",
            "Ensure resolution within 30 days",
            "Note in month-end pack",
        ],
        "low": [
            "Document explanation in workpaper",
            "Monitor for recurrence next period",
        ],
    }

    return {
        "period": request.period,
        "reconciliation_type": request.reconciliation_type,
        "commentary_per_item": per_item,
        "overall_assessment": overall,
        "risk_rating": request.risk_level,
        "recommended_actions": risk_actions.get(risk_key, risk_actions["medium"]),
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/period-close-summary")
async def period_close_summary(request: PeriodCloseSummaryRequest):
    modules_run = sum(
        [
            1 if request.roll_forward_result else 0,
            1 if request.three_way_match_result else 0,
            1 if request.anomaly_result else 0,
            1 if request.rpo_result else 0,
            1 if request.commission_result else 0,
        ]
    )

    total_exceptions = 0
    high_risk_exceptions = 0
    module_statuses: list[dict] = []

    if request.roll_forward_result:
        rf = request.roll_forward_result
        reconciled = rf.get("reconciled", False)
        module_statuses.append(
            {
                "module": "Deferred Revenue Roll-Forward",
                "status": "clean" if reconciled else rf.get("risk_level", "medium"),
                "detail": (
                    "Reconciled ✓" if reconciled else f"Difference: ${rf.get('difference', 0):,.0f}"
                ),
            }
        )
        if not reconciled:
            total_exceptions += 1
            if rf.get("risk_level") == "high":
                high_risk_exceptions += 1

    if request.three_way_match_result:
        tm = request.three_way_match_result
        match_rate = float(tm.get("match_rate_pct", 0))
        module_statuses.append(
            {
                "module": "Three-Way Match",
                "status": ("clean" if match_rate >= 95 else "medium" if match_rate >= 85 else "high"),
                "detail": f"Match rate: {match_rate:.1f}%",
            }
        )
        unmatched = int(tm.get("unmatched", 0))
        total_exceptions += unmatched
        high_risk_exceptions += int(tm.get("high_risk_count", 0))

    if request.anomaly_result:
        an = request.anomaly_result
        flagged = int(an.get("flagged_count", 0))
        module_statuses.append(
            {
                "module": "Revenue Anomaly Detection",
                "status": ("clean" if flagged == 0 else "medium" if flagged < 5 else "high"),
                "detail": f"{flagged} entries flagged",
            }
        )
        total_exceptions += flagged
        high_risk_exceptions += int(an.get("high_risk_entries", 0))

    if request.rpo_result:
        rpo = request.rpo_result
        reconciled = rpo.get("reconciled", False)
        module_statuses.append(
            {
                "module": "RPO Movement",
                "status": "clean" if reconciled else "medium",
                "detail": (
                    "Reconciled ✓" if reconciled else f"Difference: ${rpo.get('difference', 0):,.0f}"
                ),
            }
        )
        if not reconciled:
            total_exceptions += 1

    if request.commission_result:
        cm = request.commission_result
        reconciled = cm.get("reconciled", False)
        module_statuses.append(
            {
                "module": "Commission Asset",
                "status": "clean" if reconciled else "low",
                "detail": (
                    "Reconciled ✓" if reconciled else f"Difference: ${cm.get('difference', 0):,.2f}"
                ),
            }
        )
        if not reconciled:
            total_exceptions += 1

    overall_status = (
        "High Risk" if high_risk_exceptions > 0 else "Exceptions" if total_exceptions > 0 else "Clean"
    )

    nova_prompt = f"""
You are an IFRS 15 reconciliation senior manager.
Write a Big 4 executive summary memo.

Period: {request.period}
Overall status: {overall_status}
Modules completed: {modules_run}/5
Total exceptions: {total_exceptions}
High risk exceptions: {high_risk_exceptions}

Module results:
{json.dumps(module_statuses, indent=2)}

Write exactly 3 paragraphs:
Para 1: Overall period close status and headline numbers. Specific figures.
Para 2: Key exceptions and their nature. If clean period, note this positively.
Para 3: Recommended actions before final sign-off. Prioritised by risk.

Style: Big 4 senior manager memo. Professional, direct, specific.
"""
    nova_executive_summary = await call_nova(nova_prompt, max_tokens=900)

    action_items = []
    for ms in module_statuses:
        if ms["status"] in ["high", "medium"]:
            action_items.append(
                {
                    "priority": ms["status"].upper(),
                    "description": f"Resolve {ms['module']} — {ms['detail']}",
                    "owner": "Preparer",
                    "due_date": "Before period close",
                }
            )

    return {
        "period": request.period,
        "modules_run": modules_run,
        "overall_status": overall_status,
        "module_statuses": module_statuses,
        "total_exceptions": total_exceptions,
        "high_risk_exceptions": high_risk_exceptions,
        "nova_executive_summary": nova_executive_summary,
        "action_items": action_items,
        "generated_at": datetime.now().isoformat(),
    }


@router.post("/download-excel")
async def download_excel_pack(request: PeriodClosePackRequest):
    from app.services.rev_rec_excel import generate_period_close_pack

    def _run() -> dict:
        return generate_period_close_pack(request.model_dump())

    return await asyncio.to_thread(_run)


@router.get("/download-file/{file_id}")
async def download_rev_rec_file(file_id: str):
    from app.services.rev_rec_excel import REV_REC_EXCEL_OUTPUT_DIR

    if not file_id or len(file_id) > 64:
        raise HTTPException(status_code=400, detail="Invalid file_id")
    pattern = os.path.join(str(REV_REC_EXCEL_OUTPUT_DIR), f"*{file_id}*.xlsx")
    matches = sorted(glob.glob(pattern))
    if not matches:
        raise HTTPException(status_code=404, detail="File not found")
    filepath = matches[-1]
    filename = os.path.basename(filepath)
    return FileResponse(
        path=filepath,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
    )
