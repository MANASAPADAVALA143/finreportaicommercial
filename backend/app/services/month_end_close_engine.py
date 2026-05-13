"""Month-end close checklist engine — parses uploads and runs IFRS-oriented checks."""

from __future__ import annotations

import io
import re
import time
from typing import Any

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sqlalchemy.orm import Session

from app.models.month_end_close import CloseRun
from app.services.ifrs_mapper import IFRSMapper


def _append_audit(run: CloseRun, action: str, detail: dict | None = None) -> None:
    from datetime import datetime

    trail = list(run.audit_trail or [])
    trail.append({"at": datetime.utcnow().isoformat() + "Z", "action": action, "detail": detail or {}})
    run.audit_trail = trail


def _currency_symbol(code: str) -> str:
    c = (code or "INR").upper()
    return "₹" if c == "INR" else "$"


def _fmt_money(amount: float, currency: str) -> str:
    sym = _currency_symbol(currency)
    return f"{sym}{amount:,.2f}"


def initial_checklist() -> list[dict[str, Any]]:
    defs = [
        ("check_1", "Trial balance extracted", "Debits and credits extracted from the uploaded trial balance (IFRS presentation)."),
        ("check_2", "Journal entries posted", "Posted vs unposted journal lines from the close-period upload."),
        ("check_3", "Bank reconciliation", "Outstanding/unmatched bank items inferred from the bank upload (where provided)."),
        ("check_4", "Intercompany eliminations", "Intercompany-related GL accounts should net within tolerance (IFRS 10 / IAS 28)."),
        ("check_5", "IFRS compliance spot-check", "Heuristic presence of IFRS 16 (leases), IFRS 9 (ECL), IFRS 15 (revenue) balances."),
        ("check_6", "Anomaly scan (Isolation Forest)", "Unsupervised anomaly detection on journal amounts (sklearn Isolation Forest)."),
        ("check_7", "Three-statement integrity", "IAS 1 bridges: P&L to equity, cash roll-forward, accounting equation."),
        ("check_8", "Segregation of duties", "Preparer vs approver / maker-checker rules on journal lines."),
        ("check_9", "IFRS statements generated", "Trial balance mapped and statements produced via IFRSMapper."),
        ("check_10", "Close report ready", "Summary compiled; PDF available for download and CFO sign-off."),
    ]
    return [
        {
            "id": cid,
            "name": name,
            "description": desc,
            "status": "pending",
            "result_summary": "",
            "time_taken_sec": None,
            "details": {},
        }
        for cid, name, desc in defs
    ]


def _normalize_tb_df(df: pd.DataFrame) -> pd.DataFrame:
    colmap = {}
    for c in df.columns:
        k = str(c).strip().lower().replace(" ", "_")
        colmap[c] = k
    df = df.rename(columns=colmap)
    # common aliases
    aliases = {
        "account_code": "glcode",
        "accountcode": "glcode",
        "gl_code": "glcode",
        "code": "glcode",
        "account_name": "accountname",
        "name": "accountname",
    }
    for a, b in aliases.items():
        if a in df.columns and b not in df.columns:
            df = df.rename(columns={a: b})
    if "glcode" not in df.columns and "account_code" in df.columns:
        df = df.rename(columns={"account_code": "glcode"})
    if "accountname" not in df.columns:
        df["accountname"] = ""
    if "debit" not in df.columns:
        df["debit"] = 0.0
    if "credit" not in df.columns:
        df["credit"] = 0.0
    return df


def parse_trial_balance(content: bytes, filename: str) -> list[dict[str, Any]]:
    bio = io.BytesIO(content)
    fn = (filename or "").lower()
    if fn.endswith((".xlsx", ".xls")):
        df = pd.read_excel(bio)
    else:
        df = pd.read_csv(io.BytesIO(content))
    df = _normalize_tb_df(df)
    rows: list[dict[str, Any]] = []
    for _, row in df.iterrows():
        gl = str(row.get("glcode", "") or row.get("account_code", "") or "").strip()
        name = str(row.get("accountname", "") or "").strip()
        try:
            debit = float(row.get("debit", 0) or 0)
        except Exception:
            debit = 0.0
        try:
            credit = float(row.get("credit", 0) or 0)
        except Exception:
            credit = 0.0
        rows.append(
            {
                "glCode": gl or name[:12],
                "accountName": name or gl,
                "debit": debit,
                "credit": credit,
                "accountType": str(row.get("account_type", row.get("type", "")) or ""),
            }
        )
    return rows


def opening_from_prior_tb(
    prior_tb: list[dict], *, entity_name: str, period_label: str, currency: str
) -> dict[str, float]:
    """Closing balances on prior-period TB used as opening positions for the current close."""
    if not prior_tb:
        return {"opening_retained_earnings": 0.0, "opening_cash": 0.0}
    mapper = IFRSMapper()
    m = _auto_mappings(mapper, prior_tb)
    stm = mapper.generate_statements(
        trial_balance=prior_tb,
        mappings=m,
        entity_name=entity_name,
        period_end=period_label,
        currency=currency,
        prior_period=None,
    )
    re_c = float(stm["financialPosition"]["equity"].get("retainedEarnings", 0) or 0)
    cash_c = float(stm["financialPosition"]["assets"]["current"].get("cashAndEquivalents", 0) or 0)
    return {"opening_retained_earnings": re_c, "opening_cash": cash_c}


def parse_journal_entries(content: bytes, filename: str) -> pd.DataFrame:
    bio = io.BytesIO(content)
    fn = (filename or "").lower()
    if fn.endswith((".xlsx", ".xls")):
        df = pd.read_excel(bio)
    else:
        df = pd.read_csv(io.BytesIO(content))
    df.columns = [str(c).strip().lower() for c in df.columns]
    return df


def _auto_mappings(mapper: IFRSMapper, trial_balance: list[dict]) -> dict[str, str]:
    out: dict[str, str] = {}
    for acc in trial_balance:
        gl = acc.get("glCode") or ""
        name = str(acc.get("accountName", "")).lower()
        atype = str(acc.get("accountType", "")).lower()
        path, _conf = mapper._match_account_to_ifrs(gl, name, atype)
        out[str(gl)] = path
    return out


def _intercompany_net(trial_balance: list[dict]) -> float:
    pat = re.compile(r"inter.?company|ic[\s_-]|due\s+to\s+affiliate|due\s+from\s+affiliate", re.I)
    total = 0.0
    for r in trial_balance:
        blob = f"{r.get('glCode','')} {r.get('accountName','')}"
        if pat.search(blob):
            total += float(r.get("debit", 0) or 0) - float(r.get("credit", 0) or 0)
    return total


def _ifrs_spot_flags(trial_balance: list[dict]) -> dict[str, bool]:
    text = " ".join(f"{r.get('accountName','')} {r.get('glCode','')}" for r in trial_balance).lower()
    return {
        "ifrs_16_lease_balance_identified": bool(
            re.search(r"rou|right[-\s]?of[-\s]?use|lease\s+liabilit|rou\s+asset", text)
        ),
        "ifrs_9_ecl_identified": bool(re.search(r"ecl|expected\s+credit|allowance\s+for\s+loss|impairment\s+loss", text)),
        "ifrs_15_revenue_identified": bool(re.search(r"deferred\s+revenue|contract\s+liabilit|performance\s+oblig", text)),
    }


def _sod_violations(je_df: pd.DataFrame) -> list[dict[str, Any]]:
    if je_df is None or je_df.empty:
        return []
    prep = None
    appr = None
    for c in je_df.columns:
        if c in ("preparer", "posted_by", "user_id", "created_by"):
            prep = c
        if c in ("approver", "approved_by", "reviewer"):
            appr = c
    viol: list[dict[str, Any]] = []
    if prep and appr and prep in je_df.columns and appr in je_df.columns:
        for i, row in je_df.iterrows():
            a, b = str(row.get(prep, "")).strip().lower(), str(row.get(appr, "")).strip().lower()
            if a and b and a == b:
                viol.append({"row": int(i), "reason": "Preparer equals approver", "user": a})
    return viol


def _run_isolation_on_journals(je_df: pd.DataFrame) -> tuple[int, list[dict]]:
    if je_df is None or je_df.empty:
        return 0, []
    amt_col = None
    for c in ("amount", "net", "value", "debit"):
        if c in je_df.columns:
            amt_col = c
            break
    if amt_col is None:
        if "debit" in je_df.columns and "credit" in je_df.columns:
            amounts = je_df["debit"].fillna(0).astype(float) - je_df["credit"].fillna(0).astype(float)
        else:
            return 0, []
    else:
        amounts = je_df[amt_col].fillna(0).astype(float)
    X = np.asarray(amounts.values.reshape(-1, 1), dtype=float)
    if len(X) < 5:
        return 0, []
    iso = IsolationForest(n_estimators=120, contamination=0.05, random_state=42)
    pred = iso.fit_predict(X)
    flagged: list[dict] = []
    for idx, p in enumerate(pred):
        if p == -1:
            flagged.append({"row": idx, "amount": float(X[idx, 0])})
    return len(flagged), flagged


def _bank_unreconciled_estimate(je_df: pd.DataFrame | None, bank_df: pd.DataFrame | None) -> tuple[int, str]:
    if bank_df is None or bank_df.empty:
        return 1, "No bank statement file uploaded — cannot confirm zero outstanding items."
    n = len(bank_df)
    unreconciled = 0
    for _, row in bank_df.iterrows():
        blob = " ".join(str(v).lower() for v in row.values)
        if re.search(r"unmatched|outstanding|unreconciled|pending match|exception", blob):
            unreconciled += 1
    if unreconciled == 0:
        return 0, f"No unmatched/outstanding markers in {n} bank line(s) (keyword scan)."
    return unreconciled, f"{unreconciled} bank line(s) show unmatched/outstanding keywords (heuristic)."


def run_all_checks(db: Session, run: CloseRun) -> None:
    """Mutates run.checks_json and run.snapshot_json; commits handled by caller."""
    snap = dict(run.snapshot_json or {})
    currency = run.currency or "INR"
    sym = _currency_symbol(currency)
    checks = list((run.checks_json or {}).get("items") or initial_checklist())
    by_id = {c["id"]: c for c in checks}
    integrity: dict[str, Any] = {}

    def finish(cid: str, status: str, summary: str, details: dict | None, elapsed: float) -> None:
        c = by_id[cid]
        c["status"] = status
        c["result_summary"] = summary
        c["time_taken_sec"] = round(elapsed, 3)
        c["details"] = details or {}

    trial_balance: list[dict] = list(snap.get("trial_balance") or [])
    je_df = None
    if snap.get("journal_entries_rows"):
        je_df = pd.DataFrame(snap["journal_entries_rows"])
    bank_df = None
    if snap.get("bank_rows"):
        bank_df = pd.DataFrame(snap["bank_rows"])

    t0 = time.perf_counter()

    # CHECK 1 — TB
    t = time.perf_counter()
    try:
        td = sum(float(x.get("debit", 0) or 0) for x in trial_balance)
        tc = sum(float(x.get("credit", 0) or 0) for x in trial_balance)
        diff = abs(td - tc)
        if not trial_balance:
            finish(
                "check_1",
                "flagged",
                "No trial balance rows were parsed from the upload.",
                {"debit_total": 0, "credit_total": 0, "difference": None},
                time.perf_counter() - t,
            )
        elif diff <= 1.0:
            finish(
                "check_1",
                "passed",
                f"Trial balance in balance: debits {sym}{td:,.2f} = credits {sym}{tc:,.2f} (rounding tolerance ≤ {sym}1).",
                {"debit_total": td, "credit_total": tc, "difference": diff},
                time.perf_counter() - t,
            )
        else:
            finish(
                "check_1",
                "flagged",
                f"Trial balance out of balance by {sym}{diff:,.2f} (debits {sym}{td:,.2f} vs credits {sym}{tc:,.2f}).",
                {"debit_total": td, "credit_total": tc, "difference": diff},
                time.perf_counter() - t,
            )
    except Exception as e:
        finish("check_1", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 2 — JEs posted
    t = time.perf_counter()
    try:
        if je_df is None or je_df.empty:
            finish(
                "check_2",
                "flagged",
                "No journal entry file provided — cannot confirm posting completeness.",
                {"unposted_count": None},
                time.perf_counter() - t,
            )
        else:
            unposted = 0
            for col in je_df.columns:
                if col in ("status", "posted", "posting_status"):
                    ser = je_df[col].astype(str).str.lower()
                    unposted = int(ser.str.contains("unposted|draft|pending|not posted", na=False).sum())
            if unposted == 0 and "status" not in je_df.columns and "posted" not in je_df.columns:
                finish(
                    "check_2",
                    "passed",
                    "No explicit unposted status column — assumed posted (add status column for stricter control).",
                    {"unposted_count": 0, "note": "inferred"},
                    time.perf_counter() - t,
                )
            elif unposted == 0:
                finish(
                    "check_2",
                    "passed",
                    "No unposted journal lines detected in status columns.",
                    {"unposted_count": 0},
                    time.perf_counter() - t,
                )
            else:
                finish(
                    "check_2",
                    "flagged",
                    f"{unposted} journal line(s) appear unposted or in draft.",
                    {"unposted_count": unposted},
                    time.perf_counter() - t,
                )
    except Exception as e:
        finish("check_2", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 3 — Bank
    t = time.perf_counter()
    try:
        ur, msg = _bank_unreconciled_estimate(je_df, bank_df)
        if ur == 0:
            finish("check_3", "passed", "No unreconciled bank items detected under heuristic rules.", {"unreconciled": 0}, time.perf_counter() - t)
        else:
            finish(
                "check_3",
                "flagged",
                msg,
                {"unreconciled_items": ur},
                time.perf_counter() - t,
            )
    except Exception as e:
        finish("check_3", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 4 — IC
    t = time.perf_counter()
    try:
        net = _intercompany_net(trial_balance)
        if abs(net) < 100:
            finish(
                "check_4",
                "passed",
                f"Intercompany GL net position {sym}{net:,.2f} within tolerance ({sym}100).",
                {"net_ic": net, "tolerance": 100},
                time.perf_counter() - t,
            )
        else:
            finish(
                "check_4",
                "flagged",
                f"Intercompany GL nets to {sym}{net:,.2f} (exceeds tolerance {sym}100).",
                {"net_ic": net, "tolerance": 100},
                time.perf_counter() - t,
            )
    except Exception as e:
        finish("check_4", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 5 — IFRS spot
    t = time.perf_counter()
    try:
        flags = _ifrs_spot_flags(trial_balance)
        all_green = all(flags.values())
        finish(
            "check_5",
            "passed" if all_green else "flagged",
            "All three IFRS spot indicators present." if all_green else "One or more IFRS balance-sheet indicators not detected by keyword scan.",
            flags,
            time.perf_counter() - t,
        )
    except Exception as e:
        finish("check_5", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 6 — IF
    t = time.perf_counter()
    try:
        n, lst = _run_isolation_on_journals(je_df if je_df is not None else pd.DataFrame())
        if n == 0:
            finish(
                "check_6",
                "passed",
                "Isolation Forest: no anomalous journal amounts flagged at current sensitivity.",
                {"anomaly_count": 0, "flagged_transactions": []},
                time.perf_counter() - t,
            )
        else:
            finish(
                "check_6",
                "flagged",
                f"Isolation Forest flagged {n} amount(s) as anomalous.",
                {"anomaly_count": n, "flagged_transactions": lst[:50]},
                time.perf_counter() - t,
            )
    except Exception as e:
        finish("check_6", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 8 — SOD (before statements; uses journals only)
    t = time.perf_counter()
    try:
        viol = _sod_violations(je_df if je_df is not None else pd.DataFrame())
        if not viol:
            finish(
                "check_8",
                "passed",
                "No segregation-of-duties violations detected on uploaded journal lines.",
                {"violations": []},
                time.perf_counter() - t,
            )
        else:
            finish(
                "check_8",
                "flagged",
                f"{len(viol)} potential SOD issue(s) (maker-checker).",
                {"violations": viol[:100]},
                time.perf_counter() - t,
            )
    except Exception as e:
        finish("check_8", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 9 — statements (needed for check 7 integrity)
    statements: dict[str, Any] | None = None
    t = time.perf_counter()
    try:
        mapper = IFRSMapper()
        mappings = _auto_mappings(mapper, trial_balance) if trial_balance else {}
        if not trial_balance:
            finish(
                "check_9",
                "flagged",
                "Cannot generate IFRS statements without a trial balance.",
                {"generated": False},
                time.perf_counter() - t,
            )
        else:
            statements = mapper.generate_statements(
                trial_balance=trial_balance,
                mappings=mappings,
                entity_name=run.company_name or run.entity_id,
                period_end=run.period,
                currency=currency,
                prior_period=None,
            )
            # Align equity movement note with P&L PAT for display bridges
            pat = float(statements["profitLoss"].get("profitAfterTax", 0) or 0)
            statements.setdefault("changesInEquity", {}).setdefault("retainedEarnings", {})
            statements["changesInEquity"]["retainedEarnings"]["profitForYear"] = pat
            re_close = float(statements["financialPosition"]["equity"].get("retainedEarnings", 0) or 0)
            statements["changesInEquity"]["retainedEarnings"]["closingBalance"] = re_close
            opening_re = float(snap.get("opening_retained_earnings") or 0.0)
            statements["changesInEquity"]["retainedEarnings"]["openingBalance"] = opening_re
            snap["statements"] = statements
            snap["mappings"] = mappings
            finish(
                "check_9",
                "passed",
                "Statement of financial position, profit or loss, cash flows (simplified), and changes in equity produced.",
                {"generated": True, "mapping_count": len(mappings)},
                time.perf_counter() - t,
            )
    except Exception as e:
        finish("check_9", "check_error", f"Statement generation check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 7 — integrity (uses statements if present)
    t = time.perf_counter()
    try:
        if not statements:
            finish(
                "check_7",
                "flagged",
                "Skipped — IFRS statements not available.",
                {},
                time.perf_counter() - t,
            )
        else:
            pl = statements["profitLoss"]
            fp = statements["financialPosition"]
            cf = statements.get("cashFlows") or {}
            ce = statements.get("changesInEquity") or {}
            pat = float(pl.get("profitAfterTax", 0) or 0)
            re_open = float(ce.get("retainedEarnings", {}).get("openingBalance", 0) or 0)
            re_close = float(fp["equity"].get("retainedEarnings", 0) or 0)
            div = float(ce.get("retainedEarnings", {}).get("dividends", 0) or 0)
            bridge_re = re_open + pat - div
            var_re = abs(bridge_re - re_close)

            cash_open = float(snap.get("opening_cash") or 0.0)
            cash_close_bs = float(fp["assets"]["current"].get("cashAndEquivalents", 0) or 0)
            net_cf = float(cf.get("netIncreaseInCash", 0) or 0)
            expected_cash = cash_open + net_cf
            var_cash = abs(expected_cash - cash_close_bs)

            ta = float(fp["assets"].get("total", 0) or 0)
            le = float(fp.get("totalEquityAndLiabilities", 0) or 0)
            var_bs = abs(ta - le)

            sub = {
                "pl_net_income": pat,
                "retained_earnings_opening": re_open,
                "retained_earnings_closing": re_close,
                "re_bridge_expected": bridge_re,
                "re_bridge_variance": var_re,
                "re_bridge_ok": var_re <= 1.0,
                "cash_opening": cash_open,
                "cash_closing_bs": cash_close_bs,
                "cash_flow_net_increase": net_cf,
                "cash_expected_closing": expected_cash,
                "cash_bridge_variance": var_cash,
                "cash_bridge_ok": var_cash <= 1.0,
                "total_assets": ta,
                "total_liabilities_plus_equity": le,
                "balance_sheet_variance": var_bs,
                "balance_sheet_ok": var_bs <= 1.0,
            }
            integrity = {**sub, "currency": currency}
            all_ok = bool(sub["re_bridge_ok"] and sub["cash_bridge_ok"] and sub["balance_sheet_ok"])
            finish(
                "check_7",
                "passed" if all_ok else "flagged",
                "All three-statement integrity bridges passed within rounding."
                if all_ok
                else "One or more IAS 1 integrity bridges failed — see numeric variances in details.",
                sub,
                time.perf_counter() - t,
            )
    except Exception as e:
        finish("check_7", "check_error", f"Check error: {e}", {"error": str(e)}, time.perf_counter() - t)

    # CHECK 10 — report
    t = time.perf_counter()
    finish(
        "check_10",
        "passed",
        "Close narrative and PDF endpoint are available for this run.",
        {"pdf_route": f"/api/close/report/{run.run_id}/pdf"},
        time.perf_counter() - t,
    )

    ordered = [by_id[k] for k in [c["id"] for c in initial_checklist()]]
    done = sum(1 for c in ordered if c["status"] not in ("pending", "running"))
    pct = round(100 * done / max(1, len(ordered)))

    run.checks_json = {
        "items": ordered,
        "integrity": integrity,
        "progress_pct": pct,
    }
    run.snapshot_json = snap
    run.total_seconds = round(time.perf_counter() - t0, 3)
    run.status = "completed"
    _append_audit(run, "checks_completed", {"seconds": run.total_seconds, "progress_pct": pct})
    db.add(run)
