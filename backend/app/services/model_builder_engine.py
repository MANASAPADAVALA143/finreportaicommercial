"""
FP&A 3-statement model builder: historical parse, forecast, WC, debt, CFS, BS, checks, scenarios.
Uses LineItemParser.read_dataframe for file IO; multi-year extraction is local to this module.
"""

from __future__ import annotations

import copy
import re
from typing import Any

from app.services.line_item_parser import LineItemParser, parse_numeric

# --- helpers ---


def _year_from_col(name: str) -> int | None:
    s = str(name).strip().upper().replace(" ", "")
    m = re.search(r"(20\d{2}|19\d{2})", s)
    if m:
        return int(m.group(1))
    return None


def _sorted_year_columns(df) -> tuple[list[str], list[int]]:
    label_candidates = {"line_item", "item", "description", "account", "label", "metric", "name", "pl_line"}
    cols = [str(c).strip() for c in df.columns]
    cl = {c: c.lower().replace(" ", "_") for c in cols}
    label_col = None
    for c, low in cl.items():
        if low in label_candidates or any(x in low for x in ("line_item", "description", "item")):
            label_col = c
            break
    if not label_col and cols:
        label_col = cols[0]
    val_cols = [c for c in cols if c != label_col and cl.get(c, "") not in ("unit", "note", "notes")]
    pairs: list[tuple[int, str]] = []
    for c in val_cols:
        y = _year_from_col(c)
        if y is not None:
            pairs.append((y, c))
    if not pairs and val_cols:
        for i, c in enumerate(val_cols):
            pairs.append((2000 + i, c))
    pairs.sort(key=lambda x: x[0])
    return [p[1] for p in pairs], [p[0] for p in pairs]


def _row_map(df, year_cols: list[str]) -> dict[str, list[float]]:
    label_col = None
    for c in df.columns:
        low = str(c).lower().replace(" ", "_")
        if low in ("line_item", "item", "description", "account", "label", "metric", "name"):
            label_col = c
            break
    if label_col is None:
        label_col = df.columns[0]
    out: dict[str, list[float]] = {}
    for _, row in df.iterrows():
        lab = str(row.get(label_col, "")).strip()
        if not lab or lab.lower() in ("nan", "none", "total"):
            continue
        key = lab.lower()
        vals = [float(parse_numeric(row.get(c, 0))) for c in year_cols]
        out[key] = vals
    return out


def _get_row(rm: dict[str, list[float]], patterns: list[re.Pattern], n_years: int) -> list[float]:
    for k, vals in rm.items():
        for pat in patterns:
            if pat.search(k):
                return list(vals) + [0.0] * max(0, n_years - len(vals))
    return [0.0] * n_years


def parse_historical_pl(content: bytes, filename: str) -> dict[str, Any]:
    df = LineItemParser.read_dataframe(content, filename)
    if df.empty:
        raise ValueError("P&L file is empty")
    year_cols, years = _sorted_year_columns(df)
    if len(year_cols) < 1:
        raise ValueError("P&L: no year columns found")
    n = len(year_cols)
    rm = _row_map(df, year_cols)

    def row(*pats: str) -> list[float]:
        regs = [re.compile(p, re.I) for p in pats]
        return _get_row(rm, regs, n)

    revenue = row(r"^revenue$", r"\b(revenue|turnover|sales)\b")
    cogs = row(r"\bcogs\b", r"cost\s*of\s*(goods|sales|revenue)")
    gp = row(r"gross\s*profit")
    opex = row(r"operating\s*expenses", r"\bopex\b")
    ebitda = row(r"\bebitda\b")
    da = row(r"depreciation", r"\bd&a\b", r"amortization")
    ebit = row(r"\bebit\b", r"operating\s*profit")
    interest = row(r"interest\s*expense", r"\binterest\b")
    pbt = row(r"profit\s*before\s*tax", r"\bpbt\b")
    tax = row(r"^tax$", r"tax\s*expense", r"income\s*tax")
    ni = row(r"net\s*income", r"net\s*profit", r"profit\s*after\s*tax", r"\bpat\b")

    hist: list[dict[str, float]] = []
    for i in range(n):
        rev = revenue[i]
        c = cogs[i] if cogs[i] else max(0.0, rev - gp[i])
        gprofit = gp[i] if gp[i] else rev - c
        gm = (gprofit / rev) if abs(rev) > 1e-9 else 0.0
        op = opex[i] if opex[i] else max(0.0, gprofit - ebitda[i])
        eb = ebitda[i] if ebitda[i] else gprofit - op
        d = da[i]
        eb2 = ebit[i] if ebit[i] else eb - d
        intex = interest[i]
        p = pbt[i] if pbt[i] else eb2 - intex
        tx = tax[i]
        net = ni[i] if ni[i] else p - tx
        nm = (net / rev) if abs(rev) > 1e-9 else 0.0
        hist.append(
            {
                "year": years[i],
                "revenue": rev,
                "cogs": c,
                "gross_profit": gprofit,
                "gross_margin_pct": gm,
                "operating_expenses": op,
                "ebitda": eb,
                "da": d,
                "ebit": eb2,
                "interest_expense": intex,
                "pbt": p,
                "tax": tx,
                "net_income": net,
                "net_margin_pct": nm,
            }
        )
    return {"years": years, "by_year": hist, "year_columns": year_cols}


def parse_historical_bs(content: bytes, filename: str) -> dict[str, Any]:
    df = LineItemParser.read_dataframe(content, filename)
    if df.empty:
        raise ValueError("Balance sheet file is empty")
    year_cols, years = _sorted_year_columns(df)
    if len(year_cols) < 1:
        raise ValueError("BS: no year columns found")
    n = len(year_cols)
    rm = _row_map(df, year_cols)

    def row(*pats: str) -> list[float]:
        regs = [re.compile(p, re.I) for p in pats]
        return _get_row(rm, regs, n)

    cash = row(r"\bcash\b")
    ar = row(r"accounts\s*receivable", r"\bar\b")
    inv = row(r"\binventory\b")
    oca = row(r"other\s*current\s*assets")
    ppe_gross = row(r"ppe\s*gross", r"property.*gross", r"fixed\s*assets\s*gross")
    acc_dep = row(r"accumulated\s*depreciation", r"accum\.\s*depreciation")
    ppe_net = row(r"ppe\s*net", r"property.*net", r"net\s*ppe", r"fixed\s*assets(?!\s*gross)")
    intang = row(r"intangibles", r"goodwill", r"intangible")
    ap = row(r"accounts\s*payable", r"\bap\b")
    accrued = row(r"accrued")
    st_debt = row(r"short[\s-]*term\s*debt", r"current\s*portion.*debt")
    lt_debt = row(r"long[\s-]*term\s*debt")
    sc = row(r"share\s*capital", r"common\s*stock", r"equity\s*capital")
    retained = row(r"retained\s*earnings")

    hist: list[dict[str, float]] = []
    for i in range(n):
        pn = ppe_net[i]
        pg = ppe_gross[i]
        ad = acc_dep[i]
        if not pg and pn:
            pg = pn + max(0.0, ad)
        tca = cash[i] + ar[i] + inv[i] + oca[i]
        ltd = lt_debt[i]
        std = st_debt[i]
        t_debt = std + ltd
        tcl = ap[i] + accrued[i] + std
        te = sc[i] + retained[i]
        t_le = tcl + ltd + te
        ta = tca + pn + intang[i]
        t_liab = tcl + ltd
        t_le_calc = t_liab + te
        diff_open = ta - t_le_calc
        re_adj = float(retained[i])
        if abs(diff_open) > 1.0:
            # Plug RE so Assets = L+E (diff_open = TA - TLE; increase RE if TA > TLE).
            re_adj = float(retained[i]) + diff_open
        te_adj = sc[i] + re_adj
        t_le_adj = t_liab + te_adj
        hist.append(
            {
                "year": years[i],
                "cash": cash[i],
                "accounts_receivable": ar[i],
                "inventory": inv[i],
                "other_current_assets": oca[i],
                "total_current_assets": tca,
                "ppe_gross": pg,
                "accumulated_depreciation": ad,
                "ppe_net": pn,
                "intangibles": intang[i],
                "total_assets": ta,
                "accounts_payable": ap[i],
                "accrued_liabilities": accrued[i],
                "short_term_debt": std,
                "total_current_liabilities": tcl,
                "long_term_debt": ltd,
                "total_debt": t_debt,
                "total_liabilities": t_liab,
                "share_capital": sc[i],
                "retained_earnings": re_adj,
                "total_equity": te_adj,
                "total_liabilities_equity": t_le_adj,
                "opening_balance_plug_to_re": diff_open if abs(diff_open) > 1.0 else 0.0,
            }
        )
    return {"years": years, "by_year": hist, "year_columns": year_cols}


def _pad_list(xs: list[float] | None, n: int, default: float = 0.0) -> list[float]:
    if not xs:
        return [default] * n
    out = [float(x) for x in xs[:n]]
    while len(out) < n:
        out.append(out[-1] if out else default)
    return out


def normalize_assumptions(raw: dict[str, Any], n_forecast: int) -> dict[str, Any]:
    nwc = raw.get("nwc_days") or {}
    ar_d = float(nwc.get("ar_days", 45))
    inv_d = float(nwc.get("inventory_days", 30))
    ap_d = float(nwc.get("ap_days", 40))
    return {
        "revenue_growth": _pad_list(list(raw.get("revenue_growth") or []), n_forecast, 0.1),
        "gross_margin": _pad_list(list(raw.get("gross_margin") or []), n_forecast, 0.45),
        "ebitda_margin": _pad_list(list(raw.get("ebitda_margin") or []), n_forecast, 0.2),
        "tax_rate": float(raw.get("tax_rate", 0.25)),
        "capex_pct_revenue": float(raw.get("capex_pct_revenue", 0.05)),
        "da_pct_revenue": float(raw.get("da_pct_revenue", 0.04)),
        "nwc_days": {"ar_days": ar_d, "inventory_days": inv_d, "ap_days": ap_d},
        "debt_repayment": _pad_list(list(raw.get("debt_repayment") or []), n_forecast, 0.0),
        "dividend_payout": float(raw.get("dividend_payout", 0.0)),
        "interest_rate": float(raw.get("interest_rate", 0.08)),
    }


def _hist_capex(bs_hist: list[dict], pl_hist: list[dict]) -> list[float]:
    out: list[float] = []
    for i in range(len(bs_hist)):
        if i == 0:
            out.append(0.0)
            continue
        pg_t = bs_hist[i].get("ppe_gross") or 0.0
        pg_tm = bs_hist[i - 1].get("ppe_gross") or 0.0
        da = pl_hist[i].get("da", 0.0) if i < len(pl_hist) else 0.0
        if pg_t or pg_tm:
            out.append(max(0.0, pg_t - pg_tm + da))
        else:
            pn_t = bs_hist[i].get("ppe_net", 0.0)
            pn_tm = bs_hist[i - 1].get("ppe_net", 0.0)
            out.append(max(0.0, pn_t - pn_tm + da))
    return out


def _scenario_assumptions(base: dict[str, Any], kind: str) -> dict[str, Any]:
    a = copy.deepcopy(base)
    if kind == "base":
        return a
    rg = list(a["revenue_growth"])
    gm = list(a["gross_margin"])
    em = list(a["ebitda_margin"])
    if kind == "upside":
        a["revenue_growth"] = [min(0.99, float(x) + 0.03) for x in rg]
        a["gross_margin"] = [min(0.99, float(x) + 0.01) for x in gm]
        a["ebitda_margin"] = [min(0.99, float(x) + 0.01) for x in em]
    elif kind == "downside":
        a["revenue_growth"] = [float(x) - 0.05 for x in rg]
        a["gross_margin"] = [max(0.0, float(x) - 0.02) for x in gm]
        a["ebitda_margin"] = [max(0.0, float(x) - 0.02) for x in em]
    return a


def build_model_bundle(
    *,
    pl_hist_payload: dict[str, Any],
    bs_hist_payload: dict[str, Any],
    assumptions: dict[str, Any],
    base_year: int,
    forecast_years: int,
    currency: str,
) -> dict[str, Any]:
    fy = max(1, min(5, int(forecast_years)))
    asm0 = normalize_assumptions(assumptions, fy)
    return _build_single_scenario_bundle(
        pl_hist_payload=pl_hist_payload,
        bs_hist_payload=bs_hist_payload,
        assumptions=asm0,
        base_year=base_year,
        forecast_years=fy,
        currency=currency,
        scenario_name="base",
    )


def _build_single_scenario_bundle(
    *,
    pl_hist_payload: dict[str, Any],
    bs_hist_payload: dict[str, Any],
    assumptions: dict[str, Any],
    base_year: int,
    forecast_years: int,
    currency: str,
    scenario_name: str,
) -> dict[str, Any]:
    pl_y = pl_hist_payload["years"]
    bs_y = bs_hist_payload["years"]
    pl_h = pl_hist_payload["by_year"]
    bs_h = bs_hist_payload["by_year"]
    if len(pl_h) < 1 or len(bs_h) < 1:
        raise ValueError("Need at least one historical year")

    n_hist = min(len(pl_h), len(bs_h))
    pl_h = pl_h[-n_hist:]
    bs_h = bs_h[-n_hist:]

    capex_hist = _hist_capex(bs_h, pl_h)
    last_pl = pl_h[-1]
    last_bs = bs_h[-1]
    rev_last = last_pl["revenue"]
    cogs_last = last_pl["cogs"]

    ar_days_hist = (last_bs["accounts_receivable"] / rev_last * 365.0) if abs(rev_last) > 1e-9 else 0.0
    inv_days_hist = (last_bs["inventory"] / cogs_last * 365.0) if abs(cogs_last) > 1e-9 else 0.0
    ap_days_hist = (last_bs["accounts_payable"] / cogs_last * 365.0) if abs(cogs_last) > 1e-9 else 0.0

    nwc_cfg = assumptions["nwc_days"]
    ar_days = float(nwc_cfg.get("ar_days") or ar_days_hist)
    inv_days = float(nwc_cfg.get("inventory_days") or inv_days_hist)
    ap_days = float(nwc_cfg.get("ap_days") or ap_days_hist)

    fy = forecast_years
    col_labels_hist = [f"FY{y}A" for y in [r["year"] for r in pl_h]]
    f_years = [base_year + k for k in range(1, fy + 1)]
    col_labels_fc = [f"FY{y}E" for y in f_years]
    all_labels = col_labels_hist + col_labels_fc

    # --- forecast computation ---
    rev_g = assumptions["revenue_growth"][:fy]
    gm = assumptions["gross_margin"][:fy]
    em = assumptions["ebitda_margin"][:fy]
    tax_r = assumptions["tax_rate"]
    capex_pct = assumptions["capex_pct_revenue"]
    da_pct = assumptions["da_pct_revenue"]
    debt_rep = assumptions["debt_repayment"][:fy]
    div_payout = assumptions["dividend_payout"]
    int_rate = assumptions["interest_rate"]

    debt_frac_st = 0.0
    td0 = last_bs["total_debt"]
    if td0 > 1e-9:
        debt_frac_st = min(1.0, max(0.0, last_bs["short_term_debt"] / td0))

    pl_fc: list[dict[str, float]] = []
    wc_fc: list[dict[str, float]] = []
    debt_fc: list[dict[str, float]] = []
    cfs_fc: list[dict[str, float]] = []
    bs_fc: list[dict[str, float]] = []
    revolver_flags: list[str] = []
    balance_warnings: list[str] = []

    rev_prev = last_pl["revenue"]
    nwc_prev = (
        last_bs["accounts_receivable"]
        + last_bs["inventory"]
        - last_bs["accounts_payable"]
    )

    closing_debt_prev = last_bs["total_debt"]
    cash_open = last_bs["cash"]
    re_prev = last_bs["retained_earnings"]
    ppe_prev = last_bs["ppe_net"]
    oca_prev = last_bs["other_current_assets"]
    acc_prev = last_bs["accrued_liabilities"]
    int_prev = last_bs["intangibles"]
    sc_prev = last_bs["share_capital"]

    for yi in range(fy):
        y = f_years[yi]
        g = rev_g[yi]
        revenue = rev_prev * (1.0 + g)
        gross_profit = revenue * gm[yi]
        cogs = revenue - gross_profit
        ebitda = revenue * em[yi]
        opex = gross_profit - ebitda
        da = revenue * da_pct
        ebit = ebitda - da

        opening_debt = closing_debt_prev
        repayment = max(0.0, debt_rep[yi])
        new_borrow = 0.0
        interest = opening_debt * int_rate

        # Revolver: interest on opening debt only (no circularity). Borrow to cover negative cash.
        buffer = max(1000.0, abs(revenue) * 0.001)
        interest = opening_debt * int_rate
        drew_revolver = False
        for _ in range(24):
            pbt = ebit - interest
            tax = pbt * tax_r if pbt > 0 else 0.0
            net_income = pbt - tax
            dividends = net_income * div_payout

            ar = revenue * ar_days / 365.0
            inventory = cogs * inv_days / 365.0
            ap = cogs * ap_days / 365.0
            nwc = ar + inventory - ap
            delta_nwc = nwc - nwc_prev

            capex_amt = revenue * capex_pct
            capex_cf = -capex_amt

            cfo = net_income + da - delta_nwc
            cfi = capex_cf
            cff = -repayment - dividends + new_borrow
            net_chg = cfo + cfi + cff
            closing_cash = cash_open + net_chg

            if closing_cash >= -1e-6:
                break
            need = abs(closing_cash) + buffer
            new_borrow += need
            if not drew_revolver:
                revolver_flags.append(
                    f"Revolver drawn in FY{y} — review assumptions (auto-borrow +{need:,.0f} {currency})"
                )
                drew_revolver = True
            cff = -repayment - dividends + new_borrow
            net_chg = cfo + cfi + cff
            closing_cash = cash_open + net_chg

        closing_debt = opening_debt - repayment + new_borrow
        st_debt = min(closing_debt, closing_debt * debt_frac_st) if closing_debt > 0 else 0.0
        lt_debt = max(0.0, closing_debt - st_debt)

        pbt = ebit - interest
        tax = pbt * tax_r if pbt > 0 else 0.0
        net_income = pbt - tax
        dividends = net_income * div_payout

        ar = revenue * ar_days / 365.0
        inventory = cogs * inv_days / 365.0
        ap = cogs * ap_days / 365.0
        nwc = ar + inventory - ap
        delta_nwc = nwc - nwc_prev

        capex_amt = revenue * capex_pct
        capex_cf = -capex_amt
        cfo = net_income + da - delta_nwc
        cfi = capex_cf
        cff = -repayment - dividends + new_borrow
        net_chg = cfo + cfi + cff
        closing_cash = cash_open + net_chg

        ppe_net = ppe_prev - da + capex_amt
        other_ca = oca_prev
        tca = closing_cash + ar + inventory + other_ca
        intang = int_prev
        total_assets = tca + ppe_net + intang

        accrued = acc_prev
        tcl = ap + accrued + st_debt
        total_liab = tcl + lt_debt
        re_close = re_prev + net_income - dividends
        te = sc_prev + re_close
        tle = total_liab + te

        diff = total_assets - tle
        if abs(diff) > 1.0:
            balance_warnings.append(f"Balance sheet out of balance in FY{y} by {diff:,.2f}")

        pl_fc.append(
            {
                "year": y,
                "revenue": revenue,
                "cogs": cogs,
                "gross_profit": gross_profit,
                "gross_margin_pct": gross_profit / revenue if revenue else 0.0,
                "operating_expenses": opex,
                "ebitda": ebitda,
                "da": da,
                "ebit": ebit,
                "interest_expense": interest,
                "pbt": pbt,
                "tax": tax,
                "net_income": net_income,
                "net_margin_pct": net_income / revenue if revenue else 0.0,
            }
        )
        wc_fc.append(
            {
                "year": y,
                "accounts_receivable": ar,
                "inventory": inventory,
                "accounts_payable": ap,
                "nwc": nwc,
                "delta_nwc": delta_nwc,
            }
        )
        debt_fc.append(
            {
                "year": y,
                "opening_debt": opening_debt,
                "repayment": repayment,
                "new_borrowings": new_borrow,
                "closing_debt": closing_debt,
                "interest": interest,
                "short_term_debt": st_debt,
                "long_term_debt": lt_debt,
            }
        )
        cfs_fc.append(
            {
                "year": y,
                "net_income": net_income,
                "da_addback": da,
                "delta_nwc": delta_nwc,
                "cash_from_operations": cfo,
                "capex": capex_cf,
                "cash_from_investing": cfi,
                "debt_repayment": -repayment,
                "dividends": -dividends,
                "new_borrowings": new_borrow,
                "cash_from_financing": cff,
                "net_change_in_cash": net_chg,
                "opening_cash": cash_open,
                "closing_cash": closing_cash,
            }
        )
        bs_fc.append(
            {
                "year": y,
                "cash": closing_cash,
                "accounts_receivable": ar,
                "inventory": inventory,
                "other_current_assets": other_ca,
                "total_current_assets": tca,
                "ppe_net": ppe_net,
                "intangibles": intang,
                "total_assets": total_assets,
                "accounts_payable": ap,
                "accrued_liabilities": accrued,
                "short_term_debt": st_debt,
                "total_current_liabilities": tcl,
                "long_term_debt": lt_debt,
                "total_debt": closing_debt,
                "total_liabilities": total_liab,
                "share_capital": sc_prev,
                "retained_earnings": re_close,
                "total_equity": te,
                "total_liabilities_equity": tle,
                "balance_diff": diff,
            }
        )

        rev_prev = revenue
        nwc_prev = nwc
        closing_debt_prev = closing_debt
        cash_open = closing_cash
        re_prev = re_close
        ppe_prev = ppe_net
        oca_prev = other_ca
        acc_prev = accrued
        int_prev = intang

    # --- integrity checks (forecast years) ---
    checks: dict[str, Any] = {"checks": [], "summary": {}}

    def add_check(
        cid: str,
        name: str,
        years_out: list[dict[str, Any]],
    ) -> None:
        checks["checks"].append({"id": cid, "name": name, "years": years_out})

    # 1 balance
    y1_bal = []
    for i, y in enumerate(f_years):
        bs = bs_fc[i]
        ta = bs["total_assets"]
        tle = bs["total_liabilities_equity"]
        d = ta - tle
        ok = abs(d) <= 1.0
        y1_bal.append(
            {
                "year": y,
                "pass": ok,
                "actual_assets": ta,
                "actual_le": tle,
                "diff": d,
                "expected_diff": 0.0,
            }
        )
    add_check("bs_balance", "Balance Sheet Balances (Assets = L+E)", y1_bal)

    # 2 cash tie
    y2_cash = []
    for i, y in enumerate(f_years):
        cc = cfs_fc[i]["closing_cash"]
        bc = bs_fc[i]["cash"]
        diff = cc - bc
        ok = abs(diff) <= 1.0
        y2_cash.append(
            {
                "year": y,
                "pass": ok,
                "cfs_closing_cash": cc,
                "bs_cash": bc,
                "diff": diff,
                "expected_diff": 0.0,
            }
        )
    add_check("cash_tie", "Cash Ties Out (CFS closing = BS cash)", y2_cash)

    # 3 NI vs RE movement
    y3_ni = []
    bs_open = last_bs
    re_open = bs_open["retained_earnings"]
    for i, y in enumerate(f_years):
        re_c = bs_fc[i]["retained_earnings"]
        div = -cfs_fc[i]["dividends"]
        ni = pl_fc[i]["net_income"]
        expected_ni = re_c - re_open + div
        diff = ni - expected_ni
        ok = abs(diff) <= 1.0
        y3_ni.append(
            {
                "year": y,
                "pass": ok,
                "net_income": ni,
                "re_closing": re_c,
                "re_opening": re_open,
                "dividends": div,
                "expected_ni_from_re": expected_ni,
                "diff": diff,
            }
        )
        re_open = re_c
    add_check("ni_re", "Net Income Links to RE Movement", y3_ni)

    # 4 RE roll
    y4_re = []
    re_o = last_bs["retained_earnings"]
    for i, y in enumerate(f_years):
        re_c = bs_fc[i]["retained_earnings"]
        ni = pl_fc[i]["net_income"]
        div = abs(cfs_fc[i]["dividends"])
        expected = re_o + ni - div
        diff = re_c - expected
        ok = abs(diff) <= 1.0
        y4_re.append(
            {
                "year": y,
                "pass": ok,
                "re_opening": re_o,
                "net_income": ni,
                "dividends": div,
                "re_closing_expected": expected,
                "re_closing_actual": re_c,
                "diff": diff,
            }
        )
        re_o = re_c
    add_check("re_roll", "Retained Earnings Rolls Forward", y4_re)

    # 5 debt schedule
    y5_debt = []
    debt_prev = last_bs["total_debt"]
    for i, y in enumerate(f_years):
        drow = debt_fc[i]
        op = drow["opening_debt"]
        ok_open = abs(op - debt_prev) <= 1.0
        cl = drow["closing_debt"]
        exp = op - drow["repayment"] + drow["new_borrowings"]
        diff = cl - exp
        ok_sched = abs(diff) <= 1.0
        bs_td = bs_fc[i]["total_debt"]
        diff_bs = cl - bs_td
        ok_bs = abs(diff_bs) <= 1.0
        ok = ok_sched and ok_bs and ok_open
        y5_debt.append(
            {
                "year": y,
                "pass": ok,
                "opening_debt": op,
                "repayment": drow["repayment"],
                "new_borrowings": drow["new_borrowings"],
                "closing_scheduled": exp,
                "closing_actual": cl,
                "bs_total_debt": bs_td,
                "diff_sched": diff,
                "diff_open": op - debt_prev,
            }
        )
        debt_prev = cl
    add_check("debt_recon", "Debt Schedule Reconciles to Balance Sheet", y5_debt)

    # 6 interest
    y6_int = []
    for i, y in enumerate(f_years):
        ints = debt_fc[i]["interest"]
        pl_int = pl_fc[i]["interest_expense"]
        diff = pl_int - ints
        ok = abs(diff) <= 1e-3
        y6_int.append(
            {
                "year": y,
                "pass": ok,
                "debt_schedule_interest": ints,
                "pl_interest_expense": pl_int,
                "diff": diff,
            }
        )
    add_check("interest_link", "Interest Links (Debt schedule = P&L)", y6_int)

    all_pass = all(
        all(yr.get("pass") for yr in c["years"])
        for c in checks["checks"]
    )
    checks["summary"] = {"all_pass": all_pass, "scenario": scenario_name}

    # combined columnar data for UI / PDF
    pl_rows = _pl_statement_rows(pl_h, pl_fc, all_labels)
    bs_rows = _bs_statement_rows(bs_h, bs_fc, all_labels)
    cfs_rows = _cfs_statement_rows(cfs_fc, col_labels_fc)

    meta = {
        "currency": currency,
        "base_year": base_year,
        "forecast_years": fy,
        "historical_years": [r["year"] for r in pl_h],
        "forecast_year_list": f_years,
        "column_labels": all_labels,
        "historical_ratios": {
            "ar_days_implied_hist": ar_days_hist,
            "inventory_days_implied_hist": inv_days_hist,
            "ap_days_implied_hist": ap_days_hist,
            "ar_days_used": ar_days,
            "inventory_days_used": inv_days,
            "ap_days_used": ap_days,
        },
        "capex_historical_series": capex_hist,
        "revolver_messages": list(dict.fromkeys(revolver_flags)),
        "balance_sheet_warnings": balance_warnings,
        "scenario": scenario_name,
    }

    return {
        "meta": meta,
        "assumptions_used": assumptions,
        "historical": {"pl": pl_h, "bs": bs_h, "pl_years": pl_y, "bs_years": bs_y},
        "forecast": {
            "pl": pl_fc,
            "bs": bs_fc,
            "cfs": cfs_fc,
            "working_capital": wc_fc,
            "debt_schedule": debt_fc,
        },
        "statements": {
            "income_statement": pl_rows,
            "balance_sheet": bs_rows,
            "cash_flow": cfs_rows,
        },
        "checks": checks,
    }


def _pl_statement_rows(pl_h: list[dict], pl_fc: list[dict], labels: list[str]) -> dict[str, Any]:
    keys = [
        ("Revenue", "revenue"),
        ("COGS", "cogs"),
        ("Gross Profit", "gross_profit"),
        ("Gross Margin %", "gross_margin_pct", True),
        ("Operating Expenses", "operating_expenses"),
        ("EBITDA", "ebitda"),
        ("EBITDA Margin %", "ebitda_margin_pct", True),
        ("Depreciation & Amortization", "da"),
        ("EBIT", "ebit"),
        ("Interest Expense", "interest_expense"),
        ("PBT", "pbt"),
        ("Tax", "tax"),
        ("Net Income", "net_income"),
        ("Net Margin %", "net_margin_pct", True),
    ]
    rows: list[dict[str, Any]] = []
    for label, field, *rest in [(k[0], k[1], k[2] if len(k) > 2 else False) for k in keys]:
        is_pct = bool(rest[0]) if rest else False
        vals: list[float] = []
        for r in pl_h:
            if field == "ebitda_margin_pct":
                vals.append(r["ebitda"] / r["revenue"] if r["revenue"] else 0.0)
            else:
                vals.append(float(r.get(field, 0.0)))
        for r in pl_fc:
            if field == "ebitda_margin_pct":
                vals.append(r["ebitda"] / r["revenue"] if r["revenue"] else 0.0)
            else:
                vals.append(float(r.get(field, 0.0)))
        rows.append({"line": label, "is_percent": is_pct, "is_bold": label in ("Gross Profit", "EBITDA", "EBIT", "Net Income"), "values": vals[: len(labels)]})
    return {"labels": labels, "rows": rows}


def _bs_statement_rows(bs_h: list[dict], bs_fc: list[dict], labels: list[str]) -> dict[str, Any]:
    sections = [
        ("Current Assets", [("Cash", "cash"), ("Accounts Receivable", "accounts_receivable"), ("Inventory", "inventory"), ("Other Current Assets", "other_current_assets"), ("Total Current Assets", "total_current_assets", True)]),
        ("Non-Current Assets", [("PPE Net", "ppe_net"), ("Intangibles", "intangibles"), ("Total Assets", "total_assets", True)]),
        ("Current Liabilities", [("Accounts Payable", "accounts_payable"), ("Accrued Liabilities", "accrued_liabilities"), ("Short-Term Debt", "short_term_debt"), ("Total Current Liabilities", "total_current_liabilities", True)]),
        ("Long-Term Debt", [("Long-Term Debt", "long_term_debt")]),
        ("Equity", [("Share Capital", "share_capital"), ("Retained Earnings", "retained_earnings"), ("Total Equity", "total_equity", True)]),
        ("Total Liabilities + Equity", [("Total Liabilities + Equity", "total_liabilities_equity", True)]),
    ]
    rows: list[dict[str, Any]] = []
    for sec, lines in sections:
        rows.append({"line": sec, "is_header": True, "values": []})
        for tup in lines:
            label = tup[0]
            field = tup[1]
            bold = tup[2] if len(tup) > 2 else False
            vals = [float(r.get(field, 0.0)) for r in bs_h] + [float(r.get(field, 0.0)) for r in bs_fc]
            rows.append({"line": label, "is_bold": bold, "values": vals[: len(labels)]})
    return {"labels": labels, "rows": rows}


def _cfs_statement_rows(cfs_fc: list[dict], fc_labels: list[str]) -> dict[str, Any]:
    blocks = [
        (
            "Operating Activities",
            [
                ("Net Income", "net_income"),
                ("Add: D&A", "da_addback"),
                ("Less: Change in NWC", "delta_nwc"),
                ("Cash from Operations", "cash_from_operations", True),
            ],
        ),
        (
            "Investing Activities",
            [
                ("Capex", "capex"),
                ("Cash from Investing", "cash_from_investing", True),
            ],
        ),
        (
            "Financing Activities",
            [
                ("Debt Repayment", "debt_repayment"),
                ("Dividends", "dividends"),
                ("New Borrowings", "new_borrowings"),
                ("Cash from Financing", "cash_from_financing", True),
            ],
        ),
        (
            "Cash Bridge",
            [
                ("Net Change in Cash", "net_change_in_cash", True),
                ("Closing Cash", "closing_cash", True),
            ],
        ),
    ]
    rows: list[dict[str, Any]] = []
    for title, lines in blocks:
        rows.append({"line": title, "is_header": True, "values": []})
        for tup in lines:
            label = tup[0]
            field = tup[1]
            bold = tup[2] if len(tup) > 2 else False
            vals = [float(r.get(field, 0.0)) for r in cfs_fc]
            rows.append({"line": label, "is_bold": bold, "values": vals})
    return {"labels": fc_labels, "rows": rows}


def build_full_package(
    *,
    pl_hist_payload: dict[str, Any],
    bs_hist_payload: dict[str, Any],
    assumptions: dict[str, Any],
    base_year: int,
    forecast_years: int,
    currency: str,
) -> dict[str, Any]:
    fy = max(1, min(5, int(forecast_years)))
    base_asm = normalize_assumptions(assumptions, fy)
    base_model = _build_single_scenario_bundle(
        pl_hist_payload=pl_hist_payload,
        bs_hist_payload=bs_hist_payload,
        assumptions=base_asm,
        base_year=base_year,
        forecast_years=fy,
        currency=currency,
        scenario_name="base",
    )
    upside_asm = _scenario_assumptions(base_asm, "upside")
    down_asm = _scenario_assumptions(base_asm, "downside")
    upside_model = _build_single_scenario_bundle(
        pl_hist_payload=pl_hist_payload,
        bs_hist_payload=bs_hist_payload,
        assumptions=upside_asm,
        base_year=base_year,
        forecast_years=fy,
        currency=currency,
        scenario_name="upside",
    )
    downside_model = _build_single_scenario_bundle(
        pl_hist_payload=pl_hist_payload,
        bs_hist_payload=bs_hist_payload,
        assumptions=down_asm,
        base_year=base_year,
        forecast_years=fy,
        currency=currency,
        scenario_name="downside",
    )
    return {
        "base": base_model,
        "upside": upside_model,
        "downside": downside_model,
        "checks": base_model["checks"],
        "assumptions_normalized": base_asm,
    }
