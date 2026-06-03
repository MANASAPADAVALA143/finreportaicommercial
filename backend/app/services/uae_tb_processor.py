"""
UAE Trial Balance Processor
============================
Handles:
  1. Saving normalised Zoho/QBO trial balance lines to DB
  2. Converting a UAETrialBalance → IFRS TrialBalance (feeding the existing generator)
  3. Refresh-token management (called before each API request)
"""
from __future__ import annotations

import logging
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from app.models.uae_accounting import (
    AccountingSource,
    ConnectedAccount,
    UAETrialBalance,
    UAETrialBalanceLine,
)

logger = logging.getLogger(__name__)

# Map Zoho/QBO account types → IFRS AccountTypeEnum values
_ACCOUNT_TYPE_MAP: dict[str, str] = {
    # Assets
    "asset": "asset",
    "assets": "asset",
    "current asset": "asset",
    "current assets": "asset",
    "non-current assets": "asset",
    "fixed assets": "asset",
    "other assets": "asset",
    "bank": "asset",
    "cash and cash equivalents": "asset",
    "accounts receivable": "asset",
    "other receivables": "asset",
    "inventory": "asset",
    "prepaid expenses": "asset",
    # Liabilities
    "liability": "liability",
    "liabilities": "liability",
    "current liability": "liability",
    "current liabilities": "liability",
    "non-current liabilities": "liability",
    "long-term liabilities": "liability",
    "accounts payable": "liability",
    "credit cards": "liability",
    "other payables": "liability",
    "accrued liabilities": "liability",
    # Equity
    "equity": "equity",
    "owner's equity": "equity",
    "shareholder equity": "equity",
    "retained earnings": "equity",
    # Revenue
    "income": "revenue",
    "revenue": "revenue",
    "other income": "revenue",
    "sales": "revenue",
    # Expenses
    "expense": "expense",
    "expenses": "expense",
    "cost of goods sold": "expense",
    "cost of sales": "expense",
    "other expenses": "expense",
}


def _map_account_type(raw_type: str) -> str:
    """Map raw Zoho/QBO account type string → FinReportAI AccountTypeEnum value."""
    key = raw_type.strip().lower()
    return _ACCOUNT_TYPE_MAP.get(key, "asset")   # default to asset if unknown


def ensure_fresh_token(account: ConnectedAccount, db: Session) -> str:
    """
    Return a valid access token, refreshing if expired.

    Mutates the ConnectedAccount row and commits the updated tokens.
    """
    if account.token_expires_at and account.token_expires_at > datetime.utcnow():
        return account.access_token or ""   # still valid

    if not account.refresh_token:
        raise ValueError(f"No refresh token for connected account {account.id} — user must re-connect")

    logger.info("Refreshing token for account id=%s source=%s", account.id, account.source)

    if account.source == AccountingSource.zoho:
        from app.services.zoho_connector import refresh_zoho_token, token_expires_at
        tokens = refresh_zoho_token(account.refresh_token)
        account.access_token   = tokens["access_token"]
        account.token_expires_at = token_expires_at(tokens.get("expires_in", 3600))
        if tokens.get("api_domain"):
            account.api_domain = tokens["api_domain"]
    elif account.source == AccountingSource.quickbooks:
        from app.services.qbo_connector import refresh_qbo_token, token_expires_at
        tokens = refresh_qbo_token(account.refresh_token)
        account.access_token  = tokens["access_token"]
        account.refresh_token = tokens.get("refresh_token", account.refresh_token)
        account.token_expires_at = token_expires_at(tokens.get("expires_in", 3600))
    else:
        raise ValueError(f"Unknown source: {account.source}")

    db.add(account)
    db.commit()
    return account.access_token or ""


def sync_trial_balance(
    account: ConnectedAccount,
    from_date: str,
    to_date: str,
    db: Session,
) -> UAETrialBalance:
    """
    Sync a trial balance from Zoho Books or QuickBooks and persist to DB.

    Returns the saved UAETrialBalance record.
    """
    access_token = ensure_fresh_token(account, db)

    # ── Fetch raw TB from source ──────────────────────────────────────────────
    if account.source == AccountingSource.zoho:
        from app.services.zoho_connector import get_zoho_trial_balance, normalise_zoho_tb
        raw = get_zoho_trial_balance(
            access_token=access_token,
            organization_id=account.company_id_external or "",
            from_date=from_date,
            to_date=to_date,
            api_domain=account.api_domain,
        )
        lines_data = normalise_zoho_tb(raw)

    elif account.source == AccountingSource.quickbooks:
        from app.services.qbo_connector import get_qbo_trial_balance, normalise_qbo_tb
        raw = get_qbo_trial_balance(
            access_token=access_token,
            realm_id=account.company_id_external or "",
            start_date=from_date,
            end_date=to_date,
        )
        lines_data = normalise_qbo_tb(raw)

    else:
        raise ValueError(f"Unsupported source: {account.source}")

    # ── Save UAETrialBalance header ───────────────────────────────────────────
    total_debits  = sum(Decimal(str(l["debit"]))  for l in lines_data)
    total_credits = sum(Decimal(str(l["credit"])) for l in lines_data)
    is_balanced   = abs(total_debits - total_credits) < Decimal("1.00")   # AED 1 tolerance

    tb = UAETrialBalance(
        tenant_id=account.tenant_id,
        connected_account_id=account.id,
        source=account.source,
        company_name=account.company_name,
        period_start=from_date,
        period_end=to_date,
        currency=account.currency_code or "AED",
        account_count=len(lines_data),
        total_debits=float(total_debits),
        total_credits=float(total_credits),
        is_balanced=is_balanced,
        raw_data_json=raw,
        synced_at=datetime.utcnow(),
    )
    db.add(tb)
    db.flush()

    # ── Save line items ───────────────────────────────────────────────────────
    for ld in lines_data:
        line = UAETrialBalanceLine(
            trial_balance_id=tb.id,
            account_code=ld.get("account_code", ""),
            account_name=ld.get("account_name", ""),
            account_type=ld.get("account_type", "Unknown"),
            debit=float(ld.get("debit", 0)),
            credit=float(ld.get("credit", 0)),
            net_balance=float(ld.get("net_balance", 0)),
        )
        db.add(line)

    # Update last_synced_at on the connection
    account.last_synced_at = datetime.utcnow()
    account.last_error = None
    db.add(account)
    db.commit()

    logger.info(
        "sync_trial_balance: tb_id=%s source=%s lines=%d balanced=%s",
        tb.id, account.source.value, len(lines_data), is_balanced,
    )
    return tb


def generate_ifrs_from_uae_tb(
    uae_tb: UAETrialBalance,
    db: Session,
    tenant_id: str,
) -> int:
    """
    Convert a UAETrialBalance into an IFRS TrialBalance record and trigger AI mapping.

    This bridges the UAE Accounting module into the existing IFRS Statement Generator.
    Returns the new IFRS trial_balance_id.
    """
    from datetime import date
    from app.models.ifrs_statement import (
        AccountTypeEnum,
        TBStatus,
        TrialBalance,
        TrialBalanceLine,
    )

    # ── Parse dates ───────────────────────────────────────────────────────────
    def _parse(s: str) -> date | None:
        try:
            return date.fromisoformat(s)
        except (ValueError, TypeError):
            return None

    period_start = _parse(uae_tb.period_start)
    period_end   = _parse(uae_tb.period_end)

    # ── Create IFRS TrialBalance header ───────────────────────────────────────
    ifrs_tb = TrialBalance(
        tenant_id=tenant_id,
        company_name=uae_tb.company_name,
        period_start=period_start,
        period_end=period_end,
        currency=uae_tb.currency or "AED",
        uploaded_by=f"UAE Accounting sync ({uae_tb.source.value})",
        status=TBStatus.uploaded,
        file_name=f"zoho_qbo_sync_{uae_tb.id}.csv",
        file_path=None,
    )
    db.add(ifrs_tb)
    db.flush()

    # ── Create IFRS TrialBalanceLine rows ─────────────────────────────────────
    lines = uae_tb.lines
    for uae_line in lines:
        acct_type_str = _map_account_type(uae_line.account_type)
        try:
            acct_type = AccountTypeEnum(acct_type_str)
        except ValueError:
            acct_type = AccountTypeEnum.asset

        gl_code = uae_line.account_code or f"GL-{uae_line.id}"
        tbl = TrialBalanceLine(
            trial_balance_id=ifrs_tb.id,
            tenant_id=tenant_id,
            gl_code=gl_code,
            gl_description=uae_line.account_name,
            debit_amount=float(uae_line.debit or 0),
            credit_amount=float(uae_line.credit or 0),
            net_amount=float(uae_line.net_balance or 0),
            account_type=acct_type,
        )
        db.add(tbl)

    db.flush()

    # ── Save link back to UAE TB ──────────────────────────────────────────────
    uae_tb.ifrs_trial_balance_id = ifrs_tb.id
    db.add(uae_tb)
    db.commit()

    # ── Trigger AI GL mapping in background ──────────────────────────────────
    try:
        from app.services.gl_mapping_ai import apply_ai_mappings_to_db
        from app.models.ifrs_statement import TBStatus as _S

        # Run synchronously (small TBs) — for large TBs consider BackgroundTasks
        apply_ai_mappings_to_db(ifrs_tb.id, db)
        ifrs_tb.status = _S.mapped
        db.commit()
    except Exception as exc:
        logger.warning("AI mapping after UAE TB import failed (non-fatal): %s", exc)
        db.rollback()
        # Status stays as "uploaded" — user can trigger mapping manually

    logger.info(
        "generate_ifrs_from_uae_tb: uae_tb=%s → ifrs_tb=%s lines=%d",
        uae_tb.id, ifrs_tb.id, len(lines),
    )
    return ifrs_tb.id
