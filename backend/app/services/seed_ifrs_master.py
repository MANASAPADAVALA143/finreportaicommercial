from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.ifrs_statement import IFRSLineItemMaster
from app.services.statement_generator import STATEMENT_STRUCTURE

# Contra / valuation lines — flagged on master for UI; amounts still come from TB mappings.
CONTRA_LINE_ITEMS = frozenset(
    {
        "Accumulated depreciation — PPE",
        "Accumulated depreciation — ROU",
        "Accumulated amortisation — intangibles",
        "Loss allowance on receivables",
    }
)

# GL mapping dropdown + validation: Prism TB lines map here (not CF / SOCIE template lines).
MASTER_STATEMENTS = frozenset(
    {
        "financial_position",
        "profit_loss",
        "other_comprehensive_income",
    }
)


def seed_if_empty(db: Session) -> int:
    existing = db.query(IFRSLineItemMaster).count()
    if existing > 0:
        return 0

    rows: list[IFRSLineItemMaster] = []
    order = 0
    for statement, sections in STATEMENT_STRUCTURE.items():
        if statement not in MASTER_STATEMENTS:
            continue
        for section, lines in sections.items():
            if not isinstance(lines, list):
                continue
            for line_def in lines:
                name = line_def[0]
                is_structure_subtotal = len(line_def) > 2 and bool(line_def[2])
                if is_structure_subtotal:
                    continue
                standard = "IAS 1.81A" if statement == "other_comprehensive_income" else "IAS 1"
                rows.append(
                    IFRSLineItemMaster(
                        name=name,
                        statement=statement,
                        section=section,
                        sub_section=None,
                        standard=standard,
                        is_calculated=name in CONTRA_LINE_ITEMS,
                        display_order=order,
                    )
                )
                order += 1

    db.add_all(rows)
    db.commit()
    return len(rows)
