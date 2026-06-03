"""
India Payroll Service
=====================
Statutory deductions per Indian law:
  PF  — Employee 12% of basic, Employer 12% (EPS 8.33% + EPF 3.67%)
  ESI — Employee 0.75%, Employer 3.25%  (only if gross ≤ ₹21,000)
  PT  — Professional Tax (₹200/month for most states)
  Gratuity provision — 4.81% of basic (15/26 * 1/12)
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.india_accounting import (
    IndiaEmployee, IndiaPayrollRun, IndiaPayslip,
    IndiaJournalEntry, IndiaJournalLine,
)


def _uuid() -> str:
    return str(uuid.uuid4())


# ─── Constants ────────────────────────────────────────────────────────────────

PF_EMPLOYEE_RATE   = 12.0   # % of basic
PF_EMPLOYER_RATE   = 12.0   # % of basic (split: EPS 8.33 + EPF 3.67)
ESI_EMPLOYEE_RATE  = 0.75   # % of gross
ESI_EMPLOYER_RATE  = 3.25   # % of gross
ESI_WAGE_CEILING   = 21000  # ESI not applicable above this gross
PT_MONTHLY         = 200.0  # Professional Tax (most states)
GRATUITY_RATE      = 4.81   # % of basic  (15/26 / 12 * 100)
PF_WAGE_CEILING    = 15000  # PF on basic capped at 15,000 for EPS


def _calc_slip(emp: IndiaEmployee) -> dict[str, float]:
    basic  = float(emp.basic_salary or 0)
    hra    = float(emp.hra or 0)
    spl    = float(emp.special_allowance or 0)
    gross  = basic + hra + spl

    # PF
    pf_basic = min(basic, PF_WAGE_CEILING)  # EPS ceiling
    pf_emp   = round(basic * PF_EMPLOYEE_RATE / 100, 2) if emp.pf_applicable else 0.0
    pf_er    = round(basic * PF_EMPLOYER_RATE / 100, 2) if emp.pf_applicable else 0.0

    # ESI
    esi_emp  = round(gross * ESI_EMPLOYEE_RATE / 100, 2) if (emp.esi_applicable and gross <= ESI_WAGE_CEILING) else 0.0
    esi_er   = round(gross * ESI_EMPLOYER_RATE / 100, 2) if (emp.esi_applicable and gross <= ESI_WAGE_CEILING) else 0.0

    # Professional Tax
    pt = PT_MONTHLY if emp.pt_applicable else 0.0

    # TDS (simplified monthly slab — placeholder; actual annual computation needed)
    tds = 0.0

    total_deductions = pf_emp + esi_emp + pt + tds
    net_pay = round(gross - total_deductions, 2)
    gratuity = round(basic * GRATUITY_RATE / 100, 2)

    return {
        "basic": basic,
        "hra": hra,
        "special_allowance": spl,
        "gross": gross,
        "pf_employee": pf_emp,
        "pf_employer": pf_er,
        "esi_employee": esi_emp,
        "esi_employer": esi_er,
        "professional_tax": pt,
        "tds_month": tds,
        "total_deductions": total_deductions,
        "net_pay": net_pay,
        "gratuity_provision": gratuity,
    }


# ─── Run Payroll ──────────────────────────────────────────────────────────────

def run_payroll(db: Session, tenant_id: str, period: str) -> IndiaPayrollRun:
    """Process payroll for all active employees for the given period."""

    # Check if already run
    existing = (
        db.query(IndiaPayrollRun)
        .filter(
            IndiaPayrollRun.tenant_id == tenant_id,
            IndiaPayrollRun.period == period,
        )
        .first()
    )
    if existing and existing.status == "posted":
        raise ValueError(f"Payroll already posted for {period}")

    employees = (
        db.query(IndiaEmployee)
        .filter(IndiaEmployee.tenant_id == tenant_id, IndiaEmployee.status == "active")
        .all()
    )

    run = IndiaPayrollRun(
        id=_uuid(), tenant_id=tenant_id, period=period,
        total_employees=len(employees), status="draft",
    )
    db.add(run)
    db.flush()

    totals = {k: 0.0 for k in [
        "gross", "basic", "pf_employee", "pf_employer",
        "esi_employee", "esi_employer", "pt", "tds", "net_pay", "gratuity"
    ]}

    for emp in employees:
        calc = _calc_slip(emp)
        slip = IndiaPayslip(
            id=_uuid(), run_id=run.id, employee_id=emp.id,
            basic=calc["basic"],
            hra=calc["hra"],
            special_allowance=calc["special_allowance"],
            gross=calc["gross"],
            pf_employee=calc["pf_employee"],
            pf_employer=calc["pf_employer"],
            esi_employee=calc["esi_employee"],
            esi_employer=calc["esi_employer"],
            professional_tax=calc["professional_tax"],
            tds_month=calc["tds_month"],
            total_deductions=calc["total_deductions"],
            net_pay=calc["net_pay"],
            gratuity_provision=calc["gratuity_provision"],
        )
        db.add(slip)

        totals["gross"]        += calc["gross"]
        totals["basic"]        += calc["basic"]
        totals["pf_employee"]  += calc["pf_employee"]
        totals["pf_employer"]  += calc["pf_employer"]
        totals["esi_employee"] += calc["esi_employee"]
        totals["esi_employer"] += calc["esi_employer"]
        totals["pt"]           += calc["professional_tax"]
        totals["tds"]          += calc["tds_month"]
        totals["net_pay"]      += calc["net_pay"]
        totals["gratuity"]     += calc["gratuity_provision"]

    run.total_gross          = totals["gross"]
    run.total_basic          = totals["basic"]
    run.total_pf_employee    = totals["pf_employee"]
    run.total_pf_employer    = totals["pf_employer"]
    run.total_esi_employee   = totals["esi_employee"]
    run.total_esi_employer   = totals["esi_employer"]
    run.total_pt             = totals["pt"]
    run.total_tds            = totals["tds"]
    run.total_net_pay        = totals["net_pay"]
    run.total_gratuity_provision = totals["gratuity"]

    db.commit()
    db.refresh(run)
    return run


# ─── Post Payroll to GL ───────────────────────────────────────────────────────

def post_payroll(db: Session, tenant_id: str, run_id: str) -> IndiaPayrollRun:
    run = db.query(IndiaPayrollRun).filter_by(id=run_id, tenant_id=tenant_id).first()
    if not run:
        raise ValueError("Payroll run not found")
    if run.status == "posted":
        raise ValueError("Already posted")

    je_id = _uuid()
    je = IndiaJournalEntry(
        id=je_id, tenant_id=tenant_id,
        entry_date=date.today(),
        period=run.period,
        description=f"Payroll — {run.period} ({run.total_employees} employees)",
        source="payroll",
        status="posted",
        total_debit=float(run.total_gross or 0) + float(run.total_pf_employer or 0) + float(run.total_esi_employer or 0) + float(run.total_gratuity_provision or 0),
        posted_at=datetime.utcnow(),
    )
    db.add(je)
    db.flush()

    gross       = float(run.total_gross or 0)
    pf_emp      = float(run.total_pf_employee or 0)
    pf_er       = float(run.total_pf_employer or 0)
    esi_emp     = float(run.total_esi_employee or 0)
    esi_er      = float(run.total_esi_employer or 0)
    pt          = float(run.total_pt or 0)
    tds         = float(run.total_tds or 0)
    net_pay     = float(run.total_net_pay or 0)
    gratuity    = float(run.total_gratuity_provision or 0)

    lines = [
        # Dr: Salary expense
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="5100",
                         description="Gross salaries & wages", debit=gross, credit=0),
        # Dr: Employer PF contribution
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="5110",
                         description="Employer PF contribution", debit=pf_er, credit=0),
        # Dr: Employer ESI contribution
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="5111",
                         description="Employer ESI contribution", debit=esi_er, credit=0),
        # Dr: Gratuity provision
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="5112",
                         description="Gratuity provision (4.81% of basic)", debit=gratuity, credit=0),
        # Cr: Net salary payable
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2200",
                         description="Net salary payable", debit=0, credit=net_pay),
        # Cr: PF payable (employee + employer)
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2210",
                         description="PF payable (employee + employer)", debit=0, credit=pf_emp + pf_er),
        # Cr: ESI payable
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2211",
                         description="ESI payable", debit=0, credit=esi_emp + esi_er),
        # Cr: PT payable
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2212",
                         description="Professional tax payable", debit=0, credit=pt),
        # Cr: TDS payable on salary
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2400",
                         description="TDS payable on salary", debit=0, credit=tds),
        # Cr: Gratuity provision (liability)
        IndiaJournalLine(id=_uuid(), entry_id=je_id, account_code="2220",
                         description="Gratuity provision liability", debit=0, credit=gratuity),
    ]
    for ln in lines:
        db.add(ln)

    run.status = "posted"
    run.journal_entry_id = je_id
    db.commit()
    db.refresh(run)
    return run


# ─── Seed employees ──────────────────────────────────────────────────────────

def seed_sample_employees(db: Session, tenant_id: str) -> int:
    existing = db.query(IndiaEmployee).filter_by(tenant_id=tenant_id).count()
    if existing:
        return 0

    samples = [
        dict(name="Rahul Sharma",   employee_code="EMP001", department="Engineering",   designation="Senior Developer",  basic_salary=60000, hra=24000, special_allowance=16000, gross_salary=100000, pf_applicable=True, esi_applicable=False, pt_applicable=True),
        dict(name="Priya Nair",     employee_code="EMP002", department="Finance",        designation="Finance Manager",   basic_salary=50000, hra=20000, special_allowance=10000, gross_salary=80000,  pf_applicable=True, esi_applicable=False, pt_applicable=True),
        dict(name="Amit Patel",     employee_code="EMP003", department="Sales",          designation="Sales Executive",   basic_salary=20000, hra=8000,  special_allowance=5000,  gross_salary=33000,  pf_applicable=True, esi_applicable=False, pt_applicable=True),
        dict(name="Sunita Rao",     employee_code="EMP004", department="HR",             designation="HR Executive",      basic_salary=18000, hra=7200,  special_allowance=3800,  gross_salary=29000,  pf_applicable=True, esi_applicable=False, pt_applicable=True),
        dict(name="Kiran Kumar",    employee_code="EMP005", department="Operations",     designation="Operations Staff",  basic_salary=12000, hra=4800,  special_allowance=2200,  gross_salary=19000,  pf_applicable=True, esi_applicable=True,  pt_applicable=True),
    ]

    for s in samples:
        emp = IndiaEmployee(id=_uuid(), tenant_id=tenant_id, date_of_joining=date(2022, 4, 1), **s)
        db.add(emp)

    db.commit()
    return len(samples)
