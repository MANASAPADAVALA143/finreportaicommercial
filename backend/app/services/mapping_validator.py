"""
CFO AI Harness — rule-based validator (runs AFTER Claude maps).

Separate from the executor LLM: deterministic checks only.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy.orm import Session

from app.models.ifrs_statement import (
    AccountTypeEnum,
    GLMapping,
    IFRSStatementKind,
    MappingSourceEnum,
    TrialBalanceLine,
)

RuleCheck = Callable[[GLMapping, TrialBalanceLine | None, float], bool]


def human_mapping_signoff(mapping: GLMapping) -> bool:
    """User confirmed or overrode the GL→IFRS row — treat as satisfying the 70% confidence gate."""
    return bool(mapping.is_confirmed) and mapping.mapping_source in (
        MappingSourceEnum.user_confirmed,
        MappingSourceEnum.user_overridden,
    )


@dataclass(frozen=True)
class ValidationRule:
    rule_id: str
    description: str
    severity: str  # critical | error | warning | review_required
    auto_fix: bool
    fix: str | None
    check: RuleCheck


def _sign_01(mapping: GLMapping, line: TrialBalanceLine | None, amount: float) -> bool:
    sec = (mapping.ifrs_section or "").lower()
    in_asset_section = "asset" in sec and "liabilit" not in sec
    if not in_asset_section:
        return True
    if not line:
        return True
    if line.account_type != AccountTypeEnum.asset:
        return True
    return not (in_asset_section and amount < -100)


def _contra_01(mapping: GLMapping, line: TrialBalanceLine | None, amount: float) -> bool:
    desc = (mapping.gl_description or "").lower()
    if "depreciation" not in desc and "amortisation" not in desc and "amortization" not in desc:
        return True
    return bool(mapping.is_contra)


def _stmt_01(mapping: GLMapping, line: TrialBalanceLine | None, amount: float) -> bool:
    li = mapping.ifrs_line_item or ""
    if li not in ("Revenue from contracts with customers", "Other income"):
        return True
    return mapping.ifrs_statement == IFRSStatementKind.profit_loss


def _conf_01(mapping: GLMapping, line: TrialBalanceLine | None, amount: float) -> bool:
    if human_mapping_signoff(mapping):
        return True
    return (mapping.ai_confidence_score or 0.0) >= 0.70


def _tax_01(mapping: GLMapping, line: TrialBalanceLine | None, amount: float) -> bool:
    li = (mapping.ifrs_line_item or "").lower()
    if "deferred tax" not in li:
        return True
    sec = mapping.ifrs_section or ""
    return sec in ("Non-current Assets", "Non-current Liabilities")


def _suspense_01(mapping: GLMapping, line: TrialBalanceLine | None, amount: float) -> bool:
    code = (mapping.gl_code or "").lower()
    desc = (mapping.gl_description or "").lower()
    if any(x in code for x in ("999", "998")):
        return False
    if "suspense" in desc or "clearing" in desc:
        return False
    return True


VALIDATION_RULES: list[ValidationRule] = [
    ValidationRule("SIGN-01", "Asset-style mapping with unusual credit balance", "warning", False, None, _sign_01),
    ValidationRule("CONTRA-01", "Depreciation/amortisation account not marked contra", "error", True, "set is_contra = True", _contra_01),
    ValidationRule("STMT-01", "Revenue line mapped to balance sheet", "critical", False, None, _stmt_01),
    ValidationRule("CONF-01", "Low AI confidence (<70%)", "review_required", False, None, _conf_01),
    ValidationRule("TAX-01", "Deferred tax outside non-current assets/liabilities", "error", False, None, _tax_01),
    ValidationRule("SUSPENSE-01", "Suspense / clearing / high-risk GL code", "critical", False, None, _suspense_01),
]


def _dedupe_latest_mappings(db: Session, trial_balance_id: int) -> list[GLMapping]:
    raw = (
        db.query(GLMapping)
        .filter(GLMapping.trial_balance_id == trial_balance_id)
        .order_by(GLMapping.trial_balance_line_id, GLMapping.id.desc())
        .all()
    )
    seen: set[int] = set()
    out: list[GLMapping] = []
    for m in raw:
        if m.trial_balance_line_id in seen:
            continue
        seen.add(m.trial_balance_line_id)
        out.append(m)
    return out


def _run_rules_once(
    mapping: GLMapping,
    line: TrialBalanceLine | None,
    amount: float,
    results: dict[str, Any],
    *,
    apply_fixes: bool,
) -> list[dict[str, str]]:
    """Evaluate rules; optionally apply CONTRA auto-fix. Returns failed_rules metadata."""
    failed: list[dict[str, str]] = []

    for rule in VALIDATION_RULES:
        try:
            ok = rule.check(mapping, line, amount)
        except Exception:
            ok = True
        if ok:
            continue

        issue = {
            "mapping_id": mapping.id,
            "gl_code": mapping.gl_code,
            "gl_description": mapping.gl_description,
            "rule_id": rule.rule_id,
            "description": rule.description,
            "current_mapping": mapping.ifrs_line_item,
            "amount": amount,
        }

        if rule.severity == "critical":
            results["critical"].append(issue)
        elif rule.severity == "error":
            if apply_fixes and rule.auto_fix and rule.fix == "set is_contra = True":
                mapping.is_contra = True
                results["auto_fixed"].append({**issue, "fix_applied": rule.fix})
            else:
                results["errors"].append(issue)
        elif rule.severity == "warning":
            results["warnings"].append(issue)
        elif rule.severity == "review_required":
            results["review_required"].append(issue)

        failed.append({"rule_id": rule.rule_id, "severity": rule.severity})

    return failed


def _failed_rules_after_fixes(
    mapping: GLMapping,
    line: TrialBalanceLine | None,
    amount: float,
) -> list[dict[str, str]]:
    """Re-check after auto-fixes (e.g. is_contra) for persistence and scoring."""
    failed: list[dict[str, str]] = []
    for rule in VALIDATION_RULES:
        try:
            ok = rule.check(mapping, line, amount)
        except Exception:
            ok = True
        if not ok:
            failed.append({"rule_id": rule.rule_id, "severity": rule.severity})
    return failed


def validate_mappings(
    trial_balance_id: int,
    db: Session,
    *,
    apply_routing: bool = True,
    apply_fixes: bool | None = None,
) -> dict[str, Any]:
    """
    Run all validation rules against latest GL mappings for the trial balance.
    Persists per-row validator_* fields. When ``apply_routing`` is True, applies
    harness routing (auto-confirm / needs review / blocked) for AI rows;
    skips rows that are ``locked`` or already user-confirmed/overridden.

    ``apply_fixes`` defaults to ``apply_routing`` (dry checks use ``apply_routing=False``).
    """
    if apply_fixes is None:
        apply_fixes = apply_routing
    mappings = _dedupe_latest_mappings(db, trial_balance_id)
    lines = (
        db.query(TrialBalanceLine)
        .filter(TrialBalanceLine.trial_balance_id == trial_balance_id)
        .all()
    )
    line_by_id: dict[int, TrialBalanceLine] = {ln.id: ln for ln in lines}
    tb_lines_by_code: dict[str, float] = {ln.gl_code: float(ln.net_amount or 0) for ln in lines}

    results: dict[str, Any] = {
        "total_checked": len(mappings),
        "passed": 0,
        "warnings": [],
        "errors": [],
        "critical": [],
        "review_required": [],
        "auto_fixed": [],
        "harness_score": 0,
        "ready_to_generate": False,
        "summary": "",
        "auto_confirmed": 0,
        "needs_review": 0,
        "blocked": 0,
    }

    for mapping in mappings:
        line = line_by_id.get(mapping.trial_balance_line_id)
        amount = tb_lines_by_code.get(mapping.gl_code, float(line.net_amount or 0) if line else 0.0)

        # First pass: record issues + optional auto-fixes (e.g. CONTRA)
        _run_rules_once(mapping, line, amount, results, apply_fixes=apply_fixes)

        failed_rules = _failed_rules_after_fixes(mapping, line, amount)

        mapping.validator_checked = True
        mapping.validator_issues = failed_rules or None
        n_warn = sum(1 for f in failed_rules if f["severity"] == "warning")
        n_bad = sum(1 for f in failed_rules if f["severity"] in ("error", "critical"))
        conf = float(mapping.ai_confidence_score or 0.0)
        mapping.validator_score = max(0.0, min(1.0, 1.0 - 0.08 * n_warn - 0.2 * n_bad))

        has_critical = any(f["severity"] == "critical" for f in failed_rules)
        has_error = any(f["severity"] == "error" for f in failed_rules)
        has_warning = any(f["severity"] == "warning" for f in failed_rules)
        human_ok = human_mapping_signoff(mapping)
        low_conf = conf < 0.70 and not human_ok

        blocked = has_critical or has_error or low_conf
        auto_ok = (
            not blocked
            and conf >= 0.95
            and not has_warning
            and not any(f["severity"] == "review_required" for f in failed_rules)
        )

        if not apply_routing:
            mapping.validator_passed = not blocked and (conf >= 0.70 or human_ok)
            if blocked:
                results["blocked"] += 1
            elif auto_ok:
                results["passed"] += 1
            else:
                results["needs_review"] += 1
            continue

        if mapping.locked or mapping.mapping_source in (
            MappingSourceEnum.user_confirmed,
            MappingSourceEnum.user_overridden,
        ):
            mapping.validator_passed = not blocked and (conf >= 0.70 or human_ok)
            continue

        if blocked:
            mapping.validator_passed = False
            mapping.is_confirmed = False
            mapping.needs_review = True
            results["blocked"] += 1
        elif auto_ok:
            mapping.validator_passed = True
            mapping.is_confirmed = True
            mapping.needs_review = False
            results["auto_confirmed"] += 1
            results["passed"] += 1
        else:
            mapping.validator_passed = len(failed_rules) == 0 and (conf >= 0.70 or human_ok)
            mapping.is_confirmed = False
            mapping.needs_review = True
            results["needs_review"] += 1

    db.commit()

    if not mappings:
        results["harness_score"] = 0
        results["ready_to_generate"] = False
        results["summary"] = (
            "No GL→IFRS mappings found for this trial balance yet. "
            "Wait for the background AI mapping job to finish, or click Run / Re-run AI Mapping. "
            f"({len(lines)} trial balance line(s) loaded.)"
        )
        return results

    total = max(len(mappings), 1)
    not_blocked = total - results["blocked"]
    results["harness_score"] = round(not_blocked / total * 100)
    results["ready_to_generate"] = len(results["critical"]) == 0 and results["blocked"] == 0
    results["summary"] = (
        f"{results['harness_score']}% harness score. "
        f"{len(results['critical'])} critical, {len(results['errors'])} errors, "
        f"{len(results['review_required'])} low-confidence flags, "
        f"{results['auto_confirmed']} auto-confirmed."
    )
    return results


def assert_ready_for_statement_generation(trial_balance_id: int, db: Session) -> None:
    """Raise ValueError if harness blocks statement generation."""
    # Apply deterministic auto-fixes (e.g. CONTRA) but do not re-route confirmations.
    summary = validate_mappings(trial_balance_id, db, apply_routing=False, apply_fixes=True)
    if not summary.get("ready_to_generate"):
        raise ValueError(
            "CFO AI Harness: resolve blocked mappings (critical/errors or confidence <70%) before generating statements. "
            + summary.get("summary", "")
        )
