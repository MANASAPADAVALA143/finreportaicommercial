"""
GL ↔ Bank ↔ Subledger reconciliation engine.
Uses pandas merges for Layer 1; vectorised filters for Layer 2/3.
"""

from __future__ import annotations

import io
import re
import time
import uuid
from difflib import SequenceMatcher
from typing import Any

import numpy as np
import pandas as pd


def _append_audit(trail: list, action: str, detail: dict | None = None) -> None:
    from datetime import datetime

    trail.append({"at": datetime.utcnow().isoformat() + "Z", "action": action, "detail": detail or {}})


def parse_numeric(v: Any) -> float:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    for ch in "₹$€£,\u00a0 ":
        s = s.replace(ch, "")
    try:
        return float(s)
    except ValueError:
        return 0.0


def parse_date_series(s: pd.Series) -> pd.Series:
    return pd.to_datetime(s, errors="coerce", dayfirst=False, infer_datetime_format=True)


def _norm_cols(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [str(c).strip().lower().replace(" ", "_") for c in df.columns]
    return df


def _rename_aliases(df: pd.DataFrame, mapping: dict[str, list[str]]) -> pd.DataFrame:
    rev = {}
    for canon, aliases in mapping.items():
        for a in aliases:
            rev[a.lower().replace(" ", "_")] = canon
    new_names = {}
    for c in df.columns:
        key = c.lower()
        if key in rev:
            new_names[c] = rev[key]
        elif c in rev:
            new_names[c] = rev[c]
    return df.rename(columns=new_names)


def parse_gl(content: bytes, filename: str) -> pd.DataFrame:
    fn = (filename or "").lower()
    bio = io.BytesIO(content)
    if fn.endswith((".xlsx", ".xls")):
        df = pd.read_excel(bio, engine="openpyxl")
    else:
        df = pd.read_csv(io.BytesIO(content))
    df = _norm_cols(df)
    df = _rename_aliases(
        df,
        {
            "date": ["date", "txn_date", "posting_date", "value_date"],
            "reference": ["reference", "je_id", "journal_id", "doc_no", "ref"],
            "description": ["description", "narration", "memo", "details"],
            "debit": ["debit", "debit_amount", "dr"],
            "credit": ["credit", "credit_amount", "cr"],
            "amount": ["amount", "net_amount"],
            "account_code": ["account_code", "gl_code", "account", "acct_code"],
            "account_name": ["account_name", "gl_name"],
            "posted_by": ["posted_by", "preparer", "user_id"],
        },
    )
    if "date" not in df.columns:
        raise ValueError("GL file: missing Date column")
    df["date"] = parse_date_series(df["date"])
    if "debit" not in df.columns:
        df["debit"] = 0.0
    if "credit" not in df.columns:
        df["credit"] = 0.0
    df["debit"] = df["debit"].map(parse_numeric)
    df["credit"] = df["credit"].map(parse_numeric)
    if "amount" in df.columns:
        df["signed_amount"] = df["amount"].map(parse_numeric)
    else:
        df["signed_amount"] = df["debit"] - df["credit"]
    df["reference"] = df.get("reference", "").astype(str).fillna("")
    df["description"] = df.get("description", "").astype(str).fillna("")
    df["desc_clean"] = df["description"].str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
    df["row_id"] = [f"gl_{uuid.uuid4().hex[:12]}" for _ in range(len(df))]
    return df


def parse_bank(content: bytes, filename: str) -> pd.DataFrame:
    fn = (filename or "").lower()
    bio = io.BytesIO(content)
    if fn.endswith((".xlsx", ".xls")):
        df = pd.read_excel(bio, engine="openpyxl")
    else:
        df = pd.read_csv(io.BytesIO(content))
    df = _norm_cols(df)
    df = _rename_aliases(
        df,
        {
            "date": ["date", "value_date", "txn_date"],
            "description": ["description", "narration", "particulars"],
            "debit": ["debit", "withdrawals", "withdrawal", "dr"],
            "credit": ["credit", "deposits", "deposit", "cr"],
            "balance": ["balance", "closing_balance", "running_balance"],
            "reference": ["reference", "cheque_no", "chq_no", "utr", "ref"],
        },
    )
    if "date" not in df.columns:
        raise ValueError("Bank file: missing Date column")
    df["date"] = parse_date_series(df["date"])
    if "debit" not in df.columns:
        df["debit"] = 0.0
    if "credit" not in df.columns:
        df["credit"] = 0.0
    df["debit"] = df["debit"].map(parse_numeric)
    df["credit"] = df["credit"].map(parse_numeric)
    # Bank: outflow positive in debit column → net flow for matching = credit - debit (inflow positive) or match GL sign
    # Align with GL: GL rent debit 150000 matches bank debit (withdrawal) 150000 → use same signed: debit - credit
    df["signed_amount"] = df["debit"] - df["credit"]
    df["reference"] = df.get("reference", "").astype(str).fillna("")
    df["description"] = df.get("description", "").astype(str).fillna("")
    df["desc_clean"] = df["description"].str.lower().str.replace(r"\s+", " ", regex=True).str.strip()
    if "balance" in df.columns:
        df["balance"] = df["balance"].map(parse_numeric)
    else:
        df["balance"] = np.nan
    df["row_id"] = [f"bnk_{uuid.uuid4().hex[:12]}" for _ in range(len(df))]
    df = df.sort_values("date").reset_index(drop=True)
    return df


def parse_subledger(content: bytes, filename: str) -> pd.DataFrame:
    fn = (filename or "").lower()
    bio = io.BytesIO(content)
    if fn.endswith((".xlsx", ".xls")):
        df = pd.read_excel(bio, engine="openpyxl")
    else:
        df = pd.read_csv(io.BytesIO(content))
    df = _norm_cols(df)
    rev_sub = {
        "date": ["date", "due_date", "invoice_date"],
        "invoice_no": ["invoice_no", "invoice", "inv_no", "document_no"],
        "vendor_customer": ["vendor/customer", "vendor_customer", "vendor", "customer", "party"],
        "amount": ["amount", "open_amount"],
        "status": ["status"],
    }
    flat = {}
    for canon, aliases in rev_sub.items():
        for a in aliases:
            flat[a.lower().replace(" ", "_")] = canon
    new_names = {c: flat[c.lower()] for c in df.columns if c.lower() in flat}
    df = df.rename(columns=new_names)
    if "date" not in df.columns:
        raise ValueError("Subledger: missing Date column")
    df["date"] = parse_date_series(df["date"])
    if "amount" in df.columns:
        df["amount"] = df["amount"].map(parse_numeric)
    else:
        df["amount"] = 0.0
    df["invoice_no"] = df.get("invoice_no", "").astype(str).fillna("")
    df["vendor_customer"] = df.get("vendor_customer", "").astype(str).fillna("")
    df["row_id"] = [f"sub_{uuid.uuid4().hex[:12]}" for _ in range(len(df))]
    return df


def _desc_sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a, b).ratio()


def _keyword_overlap(a: str, b: str) -> float:
    wa = set(re.findall(r"[a-z0-9]{3,}", a.lower()))
    wb = set(re.findall(r"[a-z0-9]{3,}", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / max(1, len(wa | wb))


def _classify_keyword_debit(desc: str) -> tuple[str, str, str]:
    d = desc.lower()
    if any(x in d for x in ("salary", "payroll", "neft", "sal ")):
        return "61000", "Salary expense", "high"
    if any(x in d for x in ("rent", "lease")):
        return "60100", "Rent expense", "high"
    if any(x in d for x in ("interest", "int ", "int.")):
        return "70100", "Finance income", "medium"
    if any(x in d for x in ("adobe", "subscription", "software")):
        return "62000", "IT & software expense", "medium"
    if any(x in d for x in ("electric", "utility")):
        return "63000", "Utilities expense", "medium"
    if any(x in d for x in ("travel", "reimb")):
        return "64000", "Travel expense", "medium"
    if any(x in d for x in ("bank charge", "charges", "chg")):
        return "65000", "Bank charges expense", "medium"
    return "39999", "Suspense — pending allocation", "low"


def serialize_gl_bank_df(df: pd.DataFrame) -> list[dict]:
    rows = []
    has_bal = "balance" in df.columns
    for _, r in df.iterrows():
        bal = None
        if has_bal and pd.notna(r.get("balance")):
            try:
                bal = float(r["balance"])
            except (TypeError, ValueError):
                bal = None
        rows.append(
            {
                "row_id": r["row_id"],
                "date": r["date"].isoformat() if pd.notna(r["date"]) else "",
                "reference": str(r.get("reference", "")),
                "description": str(r.get("description", "")),
                "desc_clean": str(r.get("desc_clean", "")),
                "debit": float(r.get("debit", 0) or 0),
                "credit": float(r.get("credit", 0) or 0),
                "signed_amount": float(r["signed_amount"]),
                "balance": bal,
            }
        )
    return rows


def deserialize_gl_df(records: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    for c in ("debit", "credit", "signed_amount"):
        if c in df.columns:
            df[c] = df[c].astype(float)
    if "balance" in df.columns:
        def _bal(x: Any) -> float:
            if x is None or (isinstance(x, float) and np.isnan(x)):
                return np.nan
            if str(x).lower() in ("nan", "none", ""):
                return np.nan
            try:
                return float(x)
            except (TypeError, ValueError):
                return np.nan

        df["balance"] = df["balance"].map(_bal)
    else:
        df["balance"] = np.nan
    return df


def deserialize_bank_df(records: list[dict]) -> pd.DataFrame:
    return deserialize_gl_df(records)


def deserialize_subledger_df(records: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(records)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["amount"] = df["amount"].astype(float)
    if "invoice_no" not in df.columns:
        df["invoice_no"] = ""
    if "vendor_customer" not in df.columns:
        df["vendor_customer"] = ""
    df["row_id"] = df.get("row_id", [f"sub_{i}" for i in range(len(df))])
    return df


def run_reconciliation(
    gl: pd.DataFrame,
    bank: pd.DataFrame,
    subledger: pd.DataFrame | None,
    *,
    tolerance_amt: float = 0.01,
) -> dict[str, Any]:
    t0 = time.perf_counter()
    audit: list = []
    matches: list[dict] = []

    gl = gl.copy().reset_index(drop=True)
    bank = bank.copy().reset_index(drop=True)
    gl["match_key"] = gl["signed_amount"].round(2).astype(str) + "|" + gl["date"].dt.strftime("%Y-%m-%d")
    bank["match_key"] = bank["signed_amount"].round(2).astype(str) + "|" + bank["date"].dt.strftime("%Y-%m-%d")

    # Layer 1: exact amount + date
    m1 = gl.merge(
        bank,
        left_on=["signed_amount", "date"],
        right_on=["signed_amount", "date"],
        suffixes=("_gl", "_bank"),
        how="inner",
    )
    # One-to-one greedy: sort and drop duplicates
    used_g = set()
    used_b = set()
    layer1_rows = []
    for _, r in m1.sort_values(["date", "signed_amount"]).iterrows():
        gid = r["row_id_gl"]
        bid = r["row_id_bank"]
        if gid in used_g or bid in used_b:
            continue
        used_g.add(gid)
        used_b.add(bid)
        layer1_rows.append(
            {
                "layer": 1,
                "confidence": 100,
                "confidence_label": "exact",
                "gl_row_id": gid,
                "bank_row_id": bid,
                "amount": float(r["signed_amount"]),
                "gl_date": r["date_gl"].isoformat() if pd.notna(r["date_gl"]) else "",
                "bank_date": r["date_bank"].isoformat() if pd.notna(r["date_bank"]) else "",
                "gl_ref": str(r.get("reference_gl", "")),
                "bank_ref": str(r.get("reference_bank", "")),
                "gl_desc": str(r.get("description_gl", ""))[:200],
                "bank_desc": str(r.get("description_bank", ""))[:200],
            }
        )

    gl_rem = gl[~gl["row_id"].isin(used_g)].copy()
    bank_rem = bank[~bank["row_id"].isin(used_b)].copy()

    used_g2 = set(used_g)
    used_b2 = set(used_b)
    layer2_rows: list[dict] = []
    layer3_rows: list[dict] = []

    # Layer 2: merge on amount (inner) then filter date / description — avoids O(n²) cross join
    if len(gl_rem) and len(bank_rem):
        g = gl_rem.copy()
        b = bank_rem.copy()
        g["amt_key"] = g["signed_amount"].round(6)
        b["amt_key"] = b["signed_amount"].round(6)
        pairs = g.merge(b, on="amt_key", how="inner", suffixes=("_gl", "_bank"))
        pairs["date_diff"] = (pairs["date_gl"] - pairs["date_bank"]).abs().dt.days
        pairs["amt_diff"] = (pairs["signed_amount_gl"] - pairs["signed_amount_bank"]).abs()
        pairs["desc_sim"] = [
            _desc_sim(str(a), str(b))
            for a, b in zip(pairs["desc_clean_gl"], pairs["desc_clean_bank"], strict=False)
        ]
        cand = pairs[
            ((pairs["amt_diff"] <= tolerance_amt) & (pairs["date_diff"] <= 3))
            | ((pairs["signed_amount_gl"] == pairs["signed_amount_bank"]) & (pairs["date_diff"] <= 3))
            | ((pairs["desc_sim"] > 0.80) & (pairs["signed_amount_gl"] == pairs["signed_amount_bank"]))
        ].sort_values(["date_diff", "amt_diff", "desc_sim"], ascending=[True, True, False])

        for _, r in cand.iterrows():
            gid = r["row_id_gl"]
            bid = r["row_id_bank"]
            if gid in used_g2 or bid in used_b2:
                continue
            dd = int(r["date_diff"]) if pd.notna(r["date_diff"]) else 99
            ad = float(r["amt_diff"])
            ds = float(r["desc_sim"])
            if dd == 0 and ad <= tolerance_amt:
                conf, label = 99, "near"
            elif ds > 0.80 and r["signed_amount_gl"] == r["signed_amount_bank"]:
                conf, label = int(85 + 14 * ds), "near"
            elif dd <= 3 and r["signed_amount_gl"] == r["signed_amount_bank"]:
                conf, label = 90, "near"
            elif ad <= tolerance_amt and dd <= 3:
                conf, label = 88, "near"
            else:
                continue
            used_g2.add(gid)
            used_b2.add(bid)
            layer2_rows.append(
                {
                    "layer": 2,
                    "confidence": conf,
                    "confidence_label": label,
                    "gl_row_id": gid,
                    "bank_row_id": bid,
                    "amount": float(r["signed_amount_gl"]),
                    "gl_date": r["date_gl"].isoformat() if pd.notna(r["date_gl"]) else "",
                    "bank_date": r["date_bank"].isoformat() if pd.notna(r["date_bank"]) else "",
                    "gl_ref": str(r.get("reference_gl", "")),
                    "bank_ref": str(r.get("reference_bank", "")),
                    "gl_desc": str(r.get("description_gl", ""))[:200],
                    "bank_desc": str(r.get("description_bank", ""))[:200],
                }
            )

    gl_rem2 = gl[~gl["row_id"].isin(used_g2)].copy()
    bank_rem2 = bank[~bank["row_id"].isin(used_b2)].copy()

    if len(gl_rem2) and len(bank_rem2):
        g = gl_rem2.copy()
        b = bank_rem2.copy()
        g["amt_key"] = g["signed_amount"].round(6)
        b["amt_key"] = b["signed_amount"].round(6)
        pairs = g.merge(b, on="amt_key", how="inner", suffixes=("_gl", "_bank"))
        pairs["date_diff"] = (pairs["date_gl"] - pairs["date_bank"]).abs().dt.days
        pairs["kw"] = [
            _keyword_overlap(str(a), str(b))
            for a, b in zip(pairs["desc_clean_gl"], pairs["desc_clean_bank"], strict=False)
        ]
        sug = pairs[
            ((pairs["signed_amount_gl"] == pairs["signed_amount_bank"]) & (pairs["date_diff"] <= 7))
            | (pairs["kw"] > 0.60)
        ].sort_values(["date_diff", "kw"], ascending=[True, False])

        for _, r in sug.iterrows():
            gid = r["row_id_gl"]
            bid = r["row_id_bank"]
            if gid in used_g2 or bid in used_b2:
                continue
            if r["signed_amount_gl"] != r["signed_amount_bank"] and r["kw"] <= 0.60:
                continue
            dd = int(r["date_diff"]) if pd.notna(r["date_diff"]) else 7
            kw = float(r["kw"])
            conf = int(60 + min(24, kw * 24 + max(0, 7 - dd) * 2))
            used_g2.add(gid)
            used_b2.add(bid)
            layer3_rows.append(
                {
                    "layer": 3,
                    "confidence": conf,
                    "confidence_label": "suggested",
                    "gl_row_id": gid,
                    "bank_row_id": bid,
                    "amount": float(r["signed_amount_gl"]),
                    "gl_date": r["date_gl"].isoformat() if pd.notna(r["date_gl"]) else "",
                    "bank_date": r["date_bank"].isoformat() if pd.notna(r["date_bank"]) else "",
                    "gl_ref": str(r.get("reference_gl", "")),
                    "bank_ref": str(r.get("reference_bank", "")),
                    "gl_desc": str(r.get("description_gl", ""))[:200],
                    "bank_desc": str(r.get("description_bank", ""))[:200],
                }
            )

    matches.extend(layer1_rows)
    matches.extend(layer2_rows)
    matches.extend(layer3_rows)

    unmatched_gl_df = gl[~gl["row_id"].isin(used_g2)].copy()
    unmatched_bank_df = bank[~bank["row_id"].isin(used_b2)].copy()

    # Subledger checks
    sub_flags: list[dict] = []
    if subledger is not None and len(subledger):
        for m in matches:
            amt = m["amount"]
            gdesc = m.get("gl_desc", "").lower()
            sub_hit = subledger[(subledger["amount"].abs() - abs(amt)).abs() <= tolerance_amt]
            if sub_hit.empty:
                sub_flags.append({"match": m["gl_row_id"], "issue": "No subledger line with matching amount"})
            else:
                inv_ok = any(
                    str(inv).strip() and str(inv).lower() in gdesc
                    for inv in sub_hit["invoice_no"].astype(str).tolist()
                )
                max_inv_len = float(sub_hit["invoice_no"].astype(str).str.len().max() or 0)
                if not inv_ok and max_inv_len > 2:
                    sub_flags.append({"match": m["gl_row_id"], "issue": "Invoice reference not found in GL description"})

    # Break analysis
    def row_to_unmatched(row: pd.Series, source: str) -> dict:
        return {
            "row_id": row["row_id"],
            "source": source,
            "date": row["date"].isoformat() if pd.notna(row["date"]) else "",
            "reference": str(row.get("reference", "")),
            "description": str(row.get("description", ""))[:300],
            "amount": float(row["signed_amount"]),
            "category": "unknown",
            "category_note": "",
        }

    um_gl = [row_to_unmatched(r, "gl") for _, r in unmatched_gl_df.iterrows()]
    um_bk = [row_to_unmatched(r, "bank") for _, r in unmatched_bank_df.iterrows()]

    # Duplicates (same source, same amount, within 7 days)
    def mark_duplicates(rows: list[dict]) -> None:
        for i, r in enumerate(rows):
            di = pd.to_datetime(r["date"], errors="coerce")
            for j, r2 in enumerate(rows):
                if j <= i:
                    continue
                if abs(r["amount"] - r2["amount"]) > tolerance_amt:
                    continue
                dj = pd.to_datetime(r2["date"], errors="coerce")
                if pd.isna(di) or pd.isna(dj):
                    continue
                if abs((di - dj).days) <= 7:
                    r["category"] = "duplicate"
                    r["category_note"] = "Possible duplicate — verify before clearing"
                    r2["category"] = "duplicate"
                    r2["category_note"] = "Possible duplicate — verify before clearing"

    mark_duplicates(um_gl)
    mark_duplicates(um_bk)

    for r in um_gl:
        if r["category"] != "unknown":
            continue
        r["category"] = "missing_bank"
        r["category_note"] = "Outstanding item — confirm with bank / uncleared movement"

    for r in um_bk:
        if r["category"] != "unknown":
            continue
        r["category"] = "missing_gl"
        r["category_note"] = "Missing GL entry — post from bank confirmation"

    # Suggested JEs
    suggested: list[dict] = []
    je_i = 0
    for r in um_bk:
        if r["category"] != "missing_gl":
            continue
        acct, name, conf = _classify_keyword_debit(r["description"])
        je_i += 1
        suggested.append(
            {
                "id": f"je_sug_{je_i}",
                "status": "pending_review",
                "description": "Post unrecorded bank transaction (suggestion — pending review)",
                "date": r["date"],
                "debit_account": acct,
                "debit_account_name": name,
                "credit_account": "Bank / Cash",
                "credit_account_name": "Bank clearing",
                "amount": abs(r["amount"]),
                "reference": r["reference"],
                "confidence": conf,
                "source_row_id": r["row_id"],
            }
        )

    for r in um_gl:
        if r["category"] != "missing_bank":
            continue
        # Amount mismatch pairs heuristic: find bank same ref substring
        je_i += 1
        suggested.append(
            {
                "id": f"je_adj_{je_i}",
                "status": "pending_review",
                "description": "Outstanding GL — investigate before posting (suggestion — pending review)",
                "date": r["date"],
                "debit_account": "39999",
                "debit_account_name": "Suspense",
                "credit_account": "39999",
                "credit_account_name": "Suspense",
                "amount": abs(r["amount"]),
                "reference": r["reference"],
                "confidence": "low",
                "note": "Investigate before posting",
                "source_row_id": r["row_id"],
            }
        )

    gl_total = float(gl["signed_amount"].sum())
    bank_flow = float(bank["signed_amount"].sum())
    opening_bal = None
    closing_bal = None
    if bank["balance"].notna().any():
        b_sorted = bank.sort_values("date")
        first_bal = float(b_sorted["balance"].iloc[0])
        first_dr = float(b_sorted["debit"].iloc[0])
        first_cr = float(b_sorted["credit"].iloc[0])
        opening_bal = first_bal + first_dr - first_cr
        closing_bal = float(b_sorted["balance"].iloc[-1])
        bank_total_delta = closing_bal - opening_bal
    else:
        bank_total_delta = bank_flow

    difference = gl_total - bank_total_delta
    matched_count = len(matches)
    total_items = len(gl) + len(bank)
    match_rate = 100.0 * matched_count / max(1, total_items // 2) if total_items else 0.0
    matched_amount = sum(abs(m["amount"]) for m in matches)

    material_thr = max(tolerance_amt, abs(gl_total) * 0.01)
    has_unmatched = len(um_gl) + len(um_bk) > 0
    if abs(difference) <= 1.0 and not has_unmatched:
        recon_status = "CLEAN"
    elif abs(difference) > material_thr:
        recon_status = "MATERIAL BREAK"
    else:
        recon_status = "BREAKS EXIST"

    breaks_by_category: dict[str, dict[str, float]] = {}
    for r in um_gl + um_bk:
        c = r["category"]
        if c not in breaks_by_category:
            breaks_by_category[c] = {"count": 0, "amount": 0.0}
        breaks_by_category[c]["count"] += 1
        breaks_by_category[c]["amount"] += abs(r["amount"])

    summary = {
        "gl_total": gl_total,
        "bank_total_flow": bank_flow,
        "bank_opening_balance": opening_bal,
        "bank_closing_balance": closing_bal,
        "bank_net_change": bank_total_delta,
        "difference": difference,
        "matched_count": matched_count,
        "matched_amount": matched_amount,
        "match_rate_pct": round(match_rate, 2),
        "total_gl_rows": len(gl),
        "total_bank_rows": len(bank),
        "unmatched_gl_count": len(um_gl),
        "unmatched_gl_amount": sum(abs(x["amount"]) for x in um_gl),
        "unmatched_bank_count": len(um_bk),
        "unmatched_bank_amount": sum(abs(x["amount"]) for x in um_bk),
        "breaks_by_category": breaks_by_category,
        "reconciliation_status": recon_status,
        "layer1_count": len(layer1_rows),
        "layer2_count": len(layer2_rows),
        "layer3_count": len(layer3_rows),
        "subledger_flags": sub_flags,
    }

    _append_audit(audit, "reconciliation_complete", {"seconds": round(time.perf_counter() - t0, 3)})

    return {
        "matches": matches,
        "unmatched_gl": um_gl,
        "unmatched_bank": um_bk,
        "suggested_jes": suggested,
        "summary": summary,
        "audit_trail": audit,
        "total_seconds": round(time.perf_counter() - t0, 3),
    }
