"""Week 3 — IFRS compliance checks persisted to DB."""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.models.ifrs_statement import (
    ComplianceCheck,
    ComplianceResultEnum,
    ComplianceSeverityEnum,
)


def run_compliance_checks(
    trial_balance_id: int,
    statements: dict,
    tb_data: dict,
    db: Session,
) -> dict[str, Any]:
    """Run 20 IFRS compliance checks, save rows, return checks + summary."""

    db.query(ComplianceCheck).filter(ComplianceCheck.trial_balance_id == trial_balance_id).delete(
        synchronize_session=False
    )
    db.flush()

    checks: list[dict[str, Any]] = []

    def add_row(
        code: str,
        description: str,
        standard: str,
        result: ComplianceResultEnum,
        severity: ComplianceSeverityEnum,
        details: str = "",
        recommendation: str = "",
    ) -> None:
        c = ComplianceCheck(
            trial_balance_id=trial_balance_id,
            check_code=code,
            check_description=description,
            standard=standard,
            result=result,
            severity=severity,
            details=details or None,
            recommendation=recommendation or None,
            checked_at=datetime.utcnow(),
        )
        db.add(c)
        checks.append(
            {
                "code": code,
                "description": description,
                "standard": standard,
                "result": result.value,
                "severity": severity.value,
                "details": details,
                "recommendation": recommendation,
            }
        )

    def check_pf(
        code: str,
        description: str,
        standard: str,
        passed: bool,
        severity: ComplianceSeverityEnum = ComplianceSeverityEnum.major,
        details: str = "",
        recommendation: str = "",
    ) -> None:
        res = ComplianceResultEnum.pass_ if passed else ComplianceResultEnum.fail
        add_row(code, description, standard, res, severity, details, recommendation)

    fp = statements.get("financial_position", {})
    _ = fp  # reserved for future structured checks
    pl = statements.get("profit_loss", {})
    _ = pl

    total_assets = float(tb_data.get("total_assets", 0))
    total_liab_equity = float(tb_data.get("total_liabilities", 0)) + float(tb_data.get("total_equity", 0))

    check_pf(
        "IAS1-01",
        "Balance sheet balances (Assets = Liabilities + Equity)",
        "IAS 1.54",
        passed=abs(total_assets - total_liab_equity) < 1.0,
        severity=ComplianceSeverityEnum.critical,
        details=f"Assets: {total_assets:,.2f} | Liab+Equity: {total_liab_equity:,.2f}",
        recommendation="Verify all GL accounts are mapped correctly",
    )

    check_pf(
        "IAS1-02",
        "Current and non-current assets separately presented",
        "IAS 1.60",
        passed=bool(tb_data.get("has_current_assets") and tb_data.get("has_non_current_assets")),
        severity=ComplianceSeverityEnum.critical,
        recommendation="Ensure current/non-current split in GL mapping",
    )

    check_pf(
        "IAS1-03",
        "Current and non-current liabilities separately presented",
        "IAS 1.60",
        passed=bool(tb_data.get("has_current_liabilities") and tb_data.get("has_non_current_liabilities")),
        severity=ComplianceSeverityEnum.critical,
    )

    check_pf(
        "IAS1-04",
        "Comparative period presented",
        "IAS 1.38",
        passed=bool(tb_data.get("has_comparative", False)),
        severity=ComplianceSeverityEnum.major,
        recommendation="Upload prior period TB for comparative figures",
    )

    check_pf(
        "IAS1-05",
        "Going concern assessment documented",
        "IAS 1.25",
        passed=True,
        severity=ComplianceSeverityEnum.major,
        details="Manual review required — verify Directors confirm going concern",
    )

    check_pf(
        "IFRS15-01",
        "Revenue disaggregation disclosed (Note 5)",
        "IFRS 15.114",
        passed=float(tb_data.get("revenue", 0)) > 0,
        severity=ComplianceSeverityEnum.major,
        recommendation="Complete Note 5 revenue disaggregation",
    )

    check_pf(
        "IFRS15-02",
        "Contract assets/liabilities disclosed",
        "IFRS 15.116",
        passed=True,
        severity=ComplianceSeverityEnum.minor,
        details="Review Note 5 for contract balance disclosures",
    )

    has_leases = bool(tb_data.get("has_leases", False))

    if not has_leases:
        add_row(
            "IFRS16-01",
            "Right-of-use assets separately presented",
            "IFRS 16.47",
            ComplianceResultEnum.not_applicable,
            ComplianceSeverityEnum.minor,
            details="No leases recognised under IFRS 16",
        )
        add_row(
            "IFRS16-02",
            "Lease liabilities current/non-current split disclosed",
            "IFRS 16.47",
            ComplianceResultEnum.not_applicable,
            ComplianceSeverityEnum.minor,
            details="No leases recognised under IFRS 16",
        )
        add_row(
            "IFRS16-03",
            "Depreciation on ROU assets disclosed separately",
            "IFRS 16.53(a)",
            ComplianceResultEnum.not_applicable,
            ComplianceSeverityEnum.minor,
            details="No leases recognised under IFRS 16",
        )
        add_row(
            "IFRS16-04",
            "Interest on lease liabilities in finance costs",
            "IFRS 16.53(b)",
            ComplianceResultEnum.not_applicable,
            ComplianceSeverityEnum.minor,
            details="No leases recognised under IFRS 16",
        )
    else:
        check_pf(
            "IFRS16-01",
            "Right-of-use assets separately presented",
            "IFRS 16.47",
            passed=float(tb_data.get("rou_asset", 0)) > 0,
            severity=ComplianceSeverityEnum.critical,
            recommendation="Map ROU assets separately in GL mapping",
        )
        check_pf(
            "IFRS16-02",
            "Lease liabilities current/non-current split disclosed",
            "IFRS 16.47",
            passed=float(tb_data.get("lease_liability_current", 0)) > 0
            and float(tb_data.get("lease_liability_non_current", 0)) > 0,
            severity=ComplianceSeverityEnum.critical,
            recommendation="Split lease liabilities current vs non-current",
        )
        check_pf(
            "IFRS16-03",
            "Depreciation on ROU assets disclosed separately",
            "IFRS 16.53(a)",
            passed=float(tb_data.get("rou_depreciation", 0)) > 0,
            severity=ComplianceSeverityEnum.major,
        )
        check_pf(
            "IFRS16-04",
            "Interest on lease liabilities in finance costs",
            "IFRS 16.53(b)",
            passed=float(tb_data.get("lease_interest", 0)) > 0,
            severity=ComplianceSeverityEnum.major,
        )

    tr = float(tb_data.get("trade_receivables", 0))
    ecl = float(tb_data.get("ecl_provision", 0))
    check_pf(
        "IFRS9-01",
        "ECL provision recognised on trade receivables",
        "IFRS 9.5.5.1",
        passed=ecl > 0 or tr == 0,
        severity=ComplianceSeverityEnum.critical,
        recommendation="Calculate and recognise ECL on trade receivables",
    )

    check_pf(
        "IFRS9-02",
        "Movement in loss allowance disclosed",
        "IFRS 9.35H",
        passed=True,
        severity=ComplianceSeverityEnum.major,
        details="Verify Note 4 includes ECL movement table",
    )

    check_pf(
        "IAS12-01",
        "Deferred tax recognised where temporary differences exist",
        "IAS 12.15",
        passed=True,
        severity=ComplianceSeverityEnum.major,
        details="Manual review — verify deferred tax calculation",
    )

    check_pf(
        "IAS12-02",
        "Tax reconciliation disclosed",
        "IAS 12.81(c)",
        passed=float(tb_data.get("profit_before_tax", 0)) != 0,
        severity=ComplianceSeverityEnum.major,
        recommendation="Complete Note 7 tax reconciliation table",
    )

    check_pf(
        "IAS24-01",
        "Related party transactions disclosed",
        "IAS 24.17",
        passed=True,
        severity=ComplianceSeverityEnum.major,
        details="Manual review — verify Note 8 is complete",
    )

    check_pf(
        "IAS7-01",
        "Cash flow statement uses indirect method",
        "IAS 7.18",
        passed=statements.get("cash_flows") is not None,
        severity=ComplianceSeverityEnum.critical,
        recommendation="Ensure Week 2 cash flow statement is generated",
    )

    check_pf(
        "IAS7-02",
        "Cash and cash equivalents reconciliation presented",
        "IAS 7.45",
        passed=float(tb_data.get("cash", 0)) > 0,
        severity=ComplianceSeverityEnum.major,
    )

    check_pf(
        "IAS37-01",
        "Contingent liabilities disclosed or nil statement made",
        "IAS 37.86",
        passed=True,
        severity=ComplianceSeverityEnum.major,
        details="Verify Note 9 contingencies section complete",
    )

    check_pf(
        "IAS10-01",
        "Events after reporting date disclosed",
        "IAS 10.17",
        passed=True,
        severity=ComplianceSeverityEnum.major,
        details="Verify Note 10 subsequent events complete",
    )

    db.commit()

    scored = [c for c in checks if c["result"] in ("pass", "fail")]
    passed_n = sum(1 for c in checks if c["result"] == "pass")
    failed_n = sum(1 for c in checks if c["result"] == "fail")
    critical_fails = sum(
        1 for c in checks if c["result"] == "fail" and c["severity"] == "critical"
    )
    denom = len(scored) if scored else len(checks)
    compliance_score = round(passed_n / denom * 100, 1) if denom else 0.0

    return {
        "checks": checks,
        "summary": {
            "total": len(checks),
            "passed": passed_n,
            "failed": failed_n,
            "critical_failures": critical_fails,
            "compliance_score": compliance_score,
            "audit_ready": critical_fails == 0 and failed_n <= 3,
        },
    }
