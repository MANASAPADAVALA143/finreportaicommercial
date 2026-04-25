"""Financial vault — save / resolve prior-year statements (IAS 1 comparatives)."""
from __future__ import annotations

from datetime import date
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.financial_statement_vault import FinancialStatementVault, company_vault_key
from app.models.ifrs_statement import TBStatus, TrialBalance


def resolve_prior_trial_balance_id(
    db: Session,
    tenant_id: str,
    company_name: str,
    current_period_end: date | None,
    explicit_prior_id: int | None = None,
) -> int | None:
    """Option B: latest prior TB with generated statements for same company + tenant."""
    if explicit_prior_id:
        row = (
            db.query(TrialBalance)
            .filter(
                TrialBalance.id == explicit_prior_id,
                TrialBalance.tenant_id == tenant_id,
            )
            .first()
        )
        return row.id if row else None

    if not current_period_end:
        return None

    q = (
        db.query(TrialBalance)
        .filter(
            TrialBalance.tenant_id == tenant_id,
            TrialBalance.company_name == company_name,
            TrialBalance.status == TBStatus.statements_generated,
            TrialBalance.period_end.isnot(None),
            TrialBalance.period_end < current_period_end,
        )
        .order_by(TrialBalance.period_end.desc())
    )
    prior = q.first()
    return prior.id if prior else None


def load_prior_snapshot_from_vault(
    db: Session,
    tenant_id: str,
    company_name: str,
    prior_fiscal_year: int,
) -> dict[str, Any] | None:
    """If prior TB was deleted, use last saved vault JSON for that fiscal year."""
    ck = company_vault_key(tenant_id, company_name)
    row = (
        db.query(FinancialStatementVault)
        .filter(
            FinancialStatementVault.tenant_id == tenant_id,
            FinancialStatementVault.company_key == ck,
            FinancialStatementVault.fiscal_year == prior_fiscal_year,
        )
        .first()
    )
    if not row or not row.statements_payload:
        return None
    return {"statements": row.statements_payload, "period_end": row.period_end.isoformat() if row.period_end else ""}


def upsert_vault_statements(
    db: Session,
    *,
    tenant_id: str,
    company_name: str,
    trial_balance_id: int,
    period_end: date | None,
    statements_snapshot: dict[str, Any],
) -> None:
    """Persist FY statements for next-year automatic comparative (vault)."""
    if not period_end:
        return
    fy = period_end.year
    ck = company_vault_key(tenant_id, company_name)
    row = (
        db.query(FinancialStatementVault)
        .filter(
            FinancialStatementVault.tenant_id == tenant_id,
            FinancialStatementVault.company_key == ck,
            FinancialStatementVault.fiscal_year == fy,
        )
        .first()
    )
    if row:
        row.statements_payload = statements_snapshot
        row.trial_balance_id = trial_balance_id
        row.period_end = period_end
        row.status = "ai_generated"
    else:
        row = FinancialStatementVault(
            tenant_id=tenant_id,
            company_key=ck,
            company_name=company_name,
            fiscal_year=fy,
            period_end=period_end,
            trial_balance_id=trial_balance_id,
            status="ai_generated",
            statements_payload=statements_snapshot,
        )
        db.add(row)
    db.commit()
