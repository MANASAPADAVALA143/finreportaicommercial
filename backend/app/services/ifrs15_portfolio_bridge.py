"""Shape FinReportAI ifrs15_contracts rows like IFRSAI portfolio rows."""

from __future__ import annotations

import json
from typing import Any


class _Ifrs15DbBridge:
    def get_portfolio(self, company_id: str) -> list[dict[str, Any]]:
        from app.core.supabase import get_supabase

        cid = (company_id or "").strip()
        if not cid:
            return []
        try:
            res = (
                get_supabase()
                .table("ifrs15_contracts")
                .select("*")
                .eq("company_id", cid)
                .limit(2000)
                .execute()
            )
        except Exception:
            return []
        out: list[dict[str, Any]] = []
        for c in res.data or []:
            calc: dict[str, Any] = {}
            raw = c.get("calculation_json")
            if isinstance(raw, str) and raw.strip():
                try:
                    calc = json.loads(raw)
                except json.JSONDecodeError:
                    calc = {}
            elif isinstance(raw, dict):
                calc = raw
            balances = calc.get("contract_balances") if isinstance(calc, dict) else {}
            if not isinstance(balances, dict):
                balances = {}
            out.append(
                {
                    "id": c.get("id"),
                    "contract_name": c.get("contract_number") or c.get("customer_name"),
                    "contract_data": {
                        "contract_id": c.get("contract_number") or c.get("id"),
                        "customer_name": c.get("customer_name"),
                        "transaction_price": c.get("contract_value_aed"),
                        "total_transaction_price": c.get("contract_value_aed"),
                        "revenue_recognised_to_date": c.get("total_recognised_aed"),
                        "revenue_recognised": c.get("total_recognised_aed"),
                        "start_date": c.get("contract_date"),
                        "effective_date": c.get("contract_date"),
                        "contract_type": "other",
                    },
                    "summary_data": {
                        "total_recognised": c.get("total_recognised_aed")
                        or balances.get("revenue_recognized_to_date"),
                        "total_tp": c.get("contract_value_aed"),
                    },
                }
            )
        return out


ifrs15_db = _Ifrs15DbBridge()
