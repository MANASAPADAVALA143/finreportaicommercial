"""Run an entity-level agent once per entity of a group close and merge the results.

Counts and amounts add up; ageing buckets, forecast days and trend periods are combined
by key; lists are concatenated with each row tagged with its entity; percentages and other
non-additive figures are kept when every entity agrees (e.g. a policy limit) and otherwise
dropped rather than summed; flags are true if any entity's is. Group totals are in the
reporting currency (see fx.py); each entity's own figures stay in its currency. A
single-entity run returns the agent's output unchanged.
"""
from __future__ import annotations

from typing import Any, Callable

from app.services.ai_close import fx
from app.services.ai_close.context import AgentOutcome, Check, CloseContext, Entity

COMBINE_BY = {"buckets": "bucket", "prior_three_months": "period",
              "base_case": "period", "best_case": "period", "worst_case": "period"}
NON_ADDITIVE = {"materiality", "monthly_cost_assumption", "rate_pct", "history_months", "months_of_history"}


def entity_upstream(upstream: dict[str, dict[str, Any]], entity_id: str) -> dict[str, dict[str, Any]]:
    out = {}
    for agent, output in upstream.items():
        parts = output.get("entities") if isinstance(output, dict) else None
        if isinstance(parts, list) and parts and isinstance(parts[0], dict) and "entity_id" in parts[0]:
            own = next((p for p in parts if p.get("entity_id") == entity_id), None)
            if own is not None:
                out[agent] = own
            continue
        out[agent] = output
    return out


def _is_num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _combine(rows: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    merged: dict[Any, dict[str, Any]] = {}
    for row in rows:
        target = merged.setdefault(row.get(key), {})
        for k, v in row.items():
            if k == "entity":
                continue
            if k == key:
                target[k] = v
                continue
            if _is_num(v) and k not in NON_ADDITIVE and not k.endswith("pct"):
                target[k] = round(target.get(k, 0) + v, 2)
            else:
                target.setdefault(k, v)
    out = list(merged.values())
    if out and "pct" in out[0] and "amount" in out[0]:
        total = sum(r["amount"] for r in out) or 1
        for r in out:
            r["pct"] = round(r["amount"] / total * 100, 1)
    return out


def _merge_value(key: str, values: list[tuple[Entity, Any]]) -> Any:
    xs = [v for _, v in values]
    if xs and all(isinstance(v, bool) for v in xs):
        return any(xs)
    if all(_is_num(v) for v in xs):
        if key in NON_ADDITIVE or key.endswith("_pct") or key.endswith("pct"):
            return xs[0] if xs and all(v == xs[0] for v in xs) else None
        return round(sum(xs), 2)
    if all(isinstance(v, list) for v in xs):
        flat = [(e, item) for e, v in values for item in v]
        if not flat:
            return []
        if all(isinstance(i, str) for _, i in flat):
            return list(dict.fromkeys(i for _, i in flat))
        rows = [{**i, "entity": e.name} if isinstance(i, dict) else i for e, i in flat]
        if key in COMBINE_BY and all(isinstance(r, dict) for r in rows):
            return _combine(rows, COMBINE_BY[key])
        if all(isinstance(r, dict) and "day" in r for r in rows):
            return _combine(rows, "day")
        return rows
    if all(isinstance(v, dict) for v in xs):
        return _merge_dicts(values)
    if all(v == xs[0] for v in xs):
        return xs[0]
    return None


def _merge_dicts(parts: list[tuple[Entity, dict[str, Any]]]) -> dict[str, Any]:
    keys = list(dict.fromkeys(k for _, d in parts for k in d))
    return {k: _merge_value(k, [(e, d[k]) for e, d in parts if k in d and d[k] is not None]) for k in keys}


def merge_outputs(parts: list[tuple[Entity, dict[str, Any]]]) -> dict[str, Any]:
    merged = _merge_dicts(parts)
    if merged.get("total_lines"):
        merged["match_rate_pct"] = round((merged.get("matched") or 0) / merged["total_lines"] * 100, 1)
    merged["entities"] = [{"entity_id": e.id, "entity_name": e.name, "currency": e.currency, **out} for e, out in parts]
    return merged


def _group_output(agent: str | None, ctx: CloseContext, parts: list[tuple[Entity, dict[str, Any]]]) -> dict[str, Any]:
    """Merge entity outputs in the reporting currency: foreign entities are translated at the period's
    rates, and left out of group totals (but still listed) when no rates are entered."""
    included, translation, excluded = [], [], []
    for e, out in parts:
        if e.currency == ctx.currency:
            included.append((e, out))
            continue
        r = fx.rate(ctx.db, ctx.workspace_id, ctx.period, e.currency, ctx.currency)
        if r is None:
            excluded.append(e.name)
            continue
        included.append((e, fx.translate_output(agent, out, r.average_rate, r.closing_rate)))
        translation.append({"entity": e.name, "currency": e.currency, "closing_rate": r.closing_rate, "average_rate": r.average_rate})
    merged = merge_outputs(included) if included else {}
    merged["entities"] = [{"entity_id": e.id, "entity_name": e.name, "currency": e.currency, **out} for e, out in parts]
    merged["reporting_currency"] = ctx.currency
    if translation or excluded:
        notes = list(merged.get("limitations") or [])
        for t in translation:
            notes.append(f"Group totals are in {ctx.currency}: {t['entity']} translated from {t['currency']} at the closing "
                         f"rate {t['closing_rate']} (balances and forecasts) and the average rate {t['average_rate']} "
                         "(the period's income, expenses and invoices). Entity figures are shown in their own currency.")
        if excluded:
            notes.append(f"Excluded from group totals for missing {ctx.period} exchange rates: {', '.join(excluded)}.")
        merged["limitations"] = notes
        merged["translation"] = translation
        merged["excluded_entities"] = excluded
    return merged


def run_per_entity(fn: Callable[[CloseContext], AgentOutcome], ctx: CloseContext, agent: str | None = None) -> AgentOutcome:
    entities = ctx.entities or [Entity(ctx.company_id, ctx.company_id, ctx.currency)]
    multi = len(entities) > 1
    parts: list[tuple[Entity, dict[str, Any]]] = []
    total = AgentOutcome(records_processed=0, output={})
    for e in entities:
        sub = CloseContext(db=ctx.db, workspace_id=ctx.workspace_id, company_id=e.id, period=ctx.period, run_id=ctx.run_id,
                           upstream=entity_upstream(ctx.upstream, e.id), currency=e.currency, entities=[e])
        res = fn(sub)
        for x in res.exceptions:
            x.entity_id = x.entity_id or e.id
        for j in res.journals:
            j.entity_id = j.entity_id or e.id
        total.records_processed += res.records_processed
        total.exceptions += res.exceptions
        total.journals += res.journals
        total.checks += [Check(f"{c.name}:{e.id[:8]}" if multi else c.name, c.passed,
                               f"{e.name}: {c.detail}" if multi else c.detail, c.blocking) for c in res.checks]
        total.messages += [f"{e.name}: {m}" if multi else m for m in res.messages]
        parts.append((e, res.output))
    total.output = parts[0][1] if not multi else _group_output(agent, ctx, parts)
    return total
