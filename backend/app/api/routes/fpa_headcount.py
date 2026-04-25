"""Headcount planning analytics — POST /api/fpa/headcount"""

from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.fpa_commentary import fpa_commentary
from app.services.fpa_result_store import store_fpa_result

logger = logging.getLogger(__name__)
router = APIRouter(tags=["FP&A Headcount"])


class DeptRow(BaseModel):
    department: str
    current_hc: float = 0.0
    budget_hc: float = 0.0
    avg_salary: float = 0.0
    open_roles: float = 0.0


class HireEvent(BaseModel):
    month: str
    department: str
    headcount: float = 1.0


class HeadcountRequest(BaseModel):
    departments: List[DeptRow] = Field(default_factory=list)
    total_revenue: float = 45_000_000.0
    revenue_target: float = 52_000_000.0
    hiring_plan: List[HireEvent] = Field(default_factory=list)
    user_id: Optional[str] = None


@router.post("/headcount")
def headcount_plan(body: HeadcountRequest, db: Session = Depends(get_db)):
    try:
        if not body.departments:
            body.departments = [
                DeptRow(department="Engineering", current_hc=42, budget_hc=48, avg_salary=115_000, open_roles=4),
                DeptRow(department="Sales", current_hc=28, budget_hc=32, avg_salary=95_000, open_roles=2),
                DeptRow(department="G&A", current_hc=15, budget_hc=15, avg_salary=78_000, open_roles=0),
            ]

        total_hc = sum(d.current_hc for d in body.departments)
        budget_hc = sum(d.budget_hc for d in body.departments)
        variance = total_hc - budget_hc
        salary_monthly = sum(d.current_hc * d.avg_salary / 12.0 for d in body.departments)
        year_end_salary = sum((d.current_hc + d.open_roles) * d.avg_salary for d in body.departments)
        rev_per_emp = body.total_revenue / max(total_hc, 1e-6)
        sal_pct_rev = (sum(d.current_hc * d.avg_salary for d in body.departments) / max(body.total_revenue, 1e-6)) * 100.0

        dept_out = []
        for d in body.departments:
            v = d.current_hc - d.budget_hc
            flag = "balanced"
            if v > 1:
                flag = "over_budget_hc"
            elif v < -1:
                flag = "under_budget_hc"
            dept_out.append(
                {
                    "department": d.department,
                    "current_hc": d.current_hc,
                    "budget_hc": d.budget_hc,
                    "variance": v,
                    "avg_salary": d.avg_salary,
                    "open_roles": d.open_roles,
                    "flag": flag,
                }
            )

        metrics = {
            "total_hc": total_hc,
            "budget_hc": budget_hc,
            "hc_variance": variance,
            "revenue_per_employee": rev_per_emp,
            "salary_pct_of_revenue": sal_pct_rev,
            "monthly_salary_burn": salary_monthly,
            "projected_year_end_payroll": year_end_salary,
            "by_department": dept_out,
            "hiring_plan": [h.model_dump() for h in body.hiring_plan],
        }
        commentary = fpa_commentary(
            "Assess headcount efficiency vs revenue and budget; recommend hiring or rightsizing by department.",
            metrics,
        )
        out = {**metrics, "commentary": commentary}
        store_fpa_result(db, "headcount", out, user_id=body.user_id)
        return out
    except Exception as e:
        logger.exception("headcount failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
