"""UAE Fixed Assets — depreciation engine (IFRS + CT)."""
from __future__ import annotations
import logging
from datetime import date, datetime
from sqlalchemy.orm import Session
from app.models.uae_accounting_full import UAEFixedAsset

logger = logging.getLogger(__name__)

# UAE CT depreciation rates — Ministerial Decision 134 of 2023
CT_RATES: dict[str, float] = {
    "Computer":   0.333,
    "IT":         0.333,
    "Vehicle":    0.20,
    "Furniture":  0.20,
    "Machinery":  0.20,
    "Equipment":  0.20,
    "Building":   0.04,
    "Intangible": 0.10,
}


def get_ct_rate(category: str) -> float:
    for key, rate in CT_RATES.items():
        if key.lower() in category.lower():
            return rate
    return 0.20  # default 20%


def run_monthly_depreciation(tenant_id: str, period: str, db: Session) -> dict:
    """
    Run monthly depreciation for all active assets.
    Returns summary: {assets_processed, total_ifrs_dep, total_ct_dep, timing_difference}
    """
    assets = db.query(UAEFixedAsset).filter(
        UAEFixedAsset.tenant_id == tenant_id,
        UAEFixedAsset.status == "active",
    ).all()

    results = []
    total_ifrs = 0.0
    total_ct = 0.0

    for asset in assets:
        cost = float(asset.purchase_cost or 0)
        residual = float(asset.residual_value or 0)
        life_years = int(asset.useful_life_years or 5)

        # IFRS straight-line
        depreciable = cost - residual
        monthly_ifrs = depreciable / (life_years * 12) if life_years > 0 else 0

        # UAE CT rate
        ct_annual_rate = get_ct_rate(asset.category or "")
        monthly_ct = (cost * ct_annual_rate) / 12

        # Update asset
        asset.accumulated_depreciation = float(asset.accumulated_depreciation or 0) + monthly_ifrs
        asset.ct_accumulated_depreciation = float(asset.ct_accumulated_depreciation or 0) + monthly_ct
        asset.net_book_value = cost - residual - float(asset.accumulated_depreciation)
        db.add(asset)

        total_ifrs += monthly_ifrs
        total_ct += monthly_ct
        results.append({
            "asset_id": asset.id,
            "asset_name": asset.name,
            "asset_code": asset.asset_code,
            "ifrs_depreciation": round(monthly_ifrs, 2),
            "ct_depreciation": round(monthly_ct, 2),
            "timing_difference": round(monthly_ct - monthly_ifrs, 2),
        })

    db.commit()
    logger.info("Depreciation run: period=%s assets=%d ifrs=%.2f ct=%.2f", period, len(assets), total_ifrs, total_ct)
    return {
        "period": period,
        "assets_processed": len(assets),
        "total_ifrs_depreciation": round(total_ifrs, 2),
        "total_ct_depreciation": round(total_ct, 2),
        "timing_difference": round(total_ct - total_ifrs, 2),
        "lines": results,
    }


def get_depreciation_schedule(asset: UAEFixedAsset) -> list[dict]:
    """Full depreciation schedule for an asset (IFRS + CT side by side)."""
    cost = float(asset.purchase_cost or 0)
    residual = float(asset.residual_value or 0)
    life_years = int(asset.useful_life_years or 5)
    ct_rate = get_ct_rate(asset.category or "")

    schedule = []
    ifrs_cum = 0.0
    ct_cum = 0.0
    monthly_ifrs = (cost - residual) / (life_years * 12) if life_years > 0 else 0
    monthly_ct = (cost * ct_rate) / 12

    start_year = asset.purchase_date.year if asset.purchase_date else datetime.utcnow().year
    start_month = asset.purchase_date.month if asset.purchase_date else 1

    for year in range(start_year, start_year + life_years + 1):
        for month in range(1, 13):
            if year == start_year and month < start_month:
                continue
            ifrs_cum = min(ifrs_cum + monthly_ifrs, cost - residual)
            ct_cum = min(ct_cum + monthly_ct, cost)
            schedule.append({
                "period": f"{year}-{month:02d}",
                "ifrs_depreciation": round(monthly_ifrs, 2),
                "ifrs_cumulative": round(ifrs_cum, 2),
                "ifrs_nbv": round(cost - residual - ifrs_cum, 2),
                "ct_depreciation": round(monthly_ct, 2),
                "ct_cumulative": round(ct_cum, 2),
                "ct_nbv": round(cost - ct_cum, 2),
                "timing_difference": round(monthly_ct - monthly_ifrs, 2),
            })
            if ifrs_cum >= cost - residual:
                break
        else:
            continue
        break

    return schedule
