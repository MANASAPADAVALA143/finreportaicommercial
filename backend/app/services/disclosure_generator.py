"""Week 3 — IFRS disclosure notes N1–N10 (Claude)."""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.ifrs_statement import DisclosureNote, DisclosureNoteStatus, TrialBalance
from app.services.llm_service import invoke

DISCLOSURE_SYSTEM = """
You are a Big 4 audit partner with 25 years of IFRS experience.
Generate disclosure notes for financial statements.

Rules:
- Use formal financial statement language
- Reference specific IFRS/IAS paragraphs
- Never invent numbers — only use data provided
- Format headings in CAPS
- Sub-sections numbered (1.1, 1.2 etc.)
- Tables formatted as JSON when needed
- Output clean structured text only
- Length: comprehensive but concise
"""


def generate_n1_accounting_policies(tb_data: dict) -> str:
    prompt = f"""
Generate Note 1 — Significant Accounting Policies
for {tb_data.get('company_name', 'The Company')}
for the period ended {tb_data.get('period_end')}.

Company data:
- Currency: {tb_data.get('currency', 'USD')}
- Has lease liabilities: {tb_data.get('has_leases', False)}
- Has financial instruments: {tb_data.get('has_investments', False)}
- Has inventory: {tb_data.get('has_inventory', False)}
- Has borrowings: {tb_data.get('has_borrowings', False)}
- Revenue types: {tb_data.get('revenue_types', ['goods/services'])}

Generate these sub-sections:
1.1 Basis of Preparation (IAS 1.16)
    - Statement of compliance with IFRS
    - Going concern basis
    - Historical cost convention (with exceptions)

1.2 Foreign Currency (IAS 21)
    - Functional currency
    - Translation of foreign currency transactions

1.3 Revenue Recognition (IFRS 15)
    - 5-step model summary
    - When performance obligations satisfied
    - Variable consideration

1.4 Property Plant & Equipment (IAS 16)
    - Recognition criteria
    - Measurement (cost model)
    - Depreciation method + useful lives table:
      Buildings: 20-50 years
      Plant & Equipment: 5-15 years
      Motor Vehicles: 3-5 years
      Computer Equipment: 3-5 years

1.5 Leases (IFRS 16) — only if has_leases=True
    - Lessee accounting policy
    - Recognition exemptions (short-term, low-value)
    - IBR determination policy

1.6 Financial Instruments (IFRS 9) — if has_investments
    - Classification (AC, FVOCI, FVTPL)
    - ECL measurement approach

1.7 Inventories (IAS 2) — if has_inventory
    - Measurement (lower of cost and NRV)
    - Cost formula (FIFO/Weighted average)

1.8 Income Tax (IAS 12)
    - Current tax
    - Deferred tax (liability method)

1.9 Provisions (IAS 37)
    - Recognition criteria
    - Measurement

Write in full formal paragraphs. 600-800 words total.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=1500)


def generate_n2_fixed_assets(tb_data: dict) -> str:
    ppe_cost = tb_data.get("ppe_cost", 0)
    ppe_accum_dep = tb_data.get("ppe_accumulated_depreciation", 0)
    dep_charge = tb_data.get("depreciation_charge", 0)
    additions = tb_data.get("ppe_additions", 0)
    disposals = tb_data.get("ppe_disposals", 0)
    dep_on_disposals = tb_data.get("dep_on_disposals", 0)
    cost_closing = ppe_cost + additions - disposals
    accum_closing = ppe_accum_dep + dep_charge - dep_on_disposals

    prompt = f"""
Generate Note 2 — Property, Plant and Equipment
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Numbers ({tb_data.get('currency', 'USD')}):
- Cost opening: {ppe_cost:,.2f}
- Additions: {additions:,.2f}
- Disposals: {disposals:,.2f}
- Cost closing: {cost_closing:,.2f}
- Accumulated depreciation opening: {ppe_accum_dep:,.2f}
- Depreciation charge: {dep_charge:,.2f}
- Depreciation on disposals: {dep_on_disposals:,.2f}
- Accumulated dep closing: {accum_closing:,.2f}
- Net book value closing: {cost_closing - accum_closing:,.2f}

Generate:
1. PPE movement table (rollforward):
   Columns: Land | Buildings | Plant&Equip | Vehicles | Total
   Rows: Cost (open, additions, disposals, close)
         Depreciation (open, charge, disposals, close)
         Net Book Value

2. Narrative paragraph on:
   - No impairment indicators noted
   - Assets pledged as security (if borrowings exist)
   - Capital commitments

Format the table as a proper financial note table.
Reference IAS 16 paragraphs 73-79.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=800)


def generate_n3_leases(tb_data: dict) -> str:
    if not tb_data.get("has_leases"):
        return "Note 3: The Company has no lease arrangements that give rise to recognition under IFRS 16."

    rou_asset = tb_data.get("rou_asset", 0)

    prompt = f"""
Generate Note 3 — Leases (IFRS 16)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Numbers ({tb_data.get('currency', 'USD')}):
- Right-of-use assets: {rou_asset:,.2f}
- Lease liability current: {tb_data.get('lease_liability_current', 0):,.2f}
- Lease liability non-current: {tb_data.get('lease_liability_non_current', 0):,.2f}
- Depreciation on ROU assets: {tb_data.get('rou_depreciation', 0):,.2f}
- Interest on lease liabilities: {tb_data.get('lease_interest', 0):,.2f}

Generate:
3.1 Right-of-Use Assets movement table
    (opening, additions, depreciation, closing)

3.2 Lease Liabilities:
    - Current / Non-current split table
    - Maturity analysis table:
      Within 1 year | 1-5 years | Over 5 years | Total

3.3 Amounts recognised in P&L:
    - Depreciation: {tb_data.get('rou_depreciation', 0):,.2f}
    - Interest expense: {tb_data.get('lease_interest', 0):,.2f}

3.4 Cash outflows for leases

Reference IFRS 16.53, 16.58, 16.94.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=700)


def generate_n4_financial_instruments(tb_data: dict) -> str:
    receivables = tb_data.get("trade_receivables", 0)
    ecl_provision = tb_data.get("ecl_provision", receivables * 0.03)

    prompt = f"""
Generate Note 4 — Financial Instruments and Credit Risk (IFRS 9)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Numbers ({tb_data.get('currency', 'USD')}):
- Gross trade receivables: {receivables:,.2f}
- ECL provision: {ecl_provision:,.2f}
- Net trade receivables: {receivables - ecl_provision:,.2f}
- Cash and equivalents: {tb_data.get('cash', 0):,.2f}
- Short-term borrowings: {tb_data.get('short_term_borrowings', 0):,.2f}
- Long-term borrowings: {tb_data.get('long_term_borrowings', 0):,.2f}

Generate:
4.1 Classification of financial instruments table
    (AC / FVOCI / FVTPL for each category)

4.2 Credit Risk — Trade Receivables:
    - Provision matrix table:
      Current | 1-30 days | 31-60 | 61-90 | 90+ | Total
      Gross amount | ECL rate | Provision

4.3 Movement in ECL provision:
    Opening | Charge for period | Write-offs | Closing

4.4 Liquidity Risk:
    - Maturity of financial liabilities table

4.5 Interest Rate Risk:
    - Fixed vs floating rate borrowings

Reference IFRS 9 para 35H-35N, IFRS 7.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=900)


def generate_n5_revenue(tb_data: dict) -> str:
    revenue = tb_data.get("revenue", 0)
    other_income = tb_data.get("other_income", 0)

    prompt = f"""
Generate Note 5 — Revenue (IFRS 15)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Numbers ({tb_data.get('currency', 'USD')}):
- Revenue from contracts: {revenue:,.2f}
- Other income: {other_income:,.2f}
- Total: {revenue + other_income:,.2f}

Generate:
5.1 Disaggregation of Revenue table:
    - By type: Goods | Services | Other
    - By timing: Point in time | Over time

5.2 Contract Balances:
    - Contract assets (if any)
    - Contract liabilities / deferred revenue

5.3 Performance Obligations:
    - Description of remaining obligations
    - When expected to be satisfied

5.4 Significant Judgements:
    - Timing of satisfaction
    - Variable consideration estimates

Reference IFRS 15.114-115, 15.120.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=600)


def generate_n6_borrowings(tb_data: dict) -> str:
    if not tb_data.get("has_borrowings"):
        return "Note 6: The Company had no interest-bearing borrowings during the period."

    prompt = f"""
Generate Note 6 — Borrowings (IFRS 9 / IAS 1)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Numbers ({tb_data.get('currency', 'USD')}):
- Bank loans current: {tb_data.get('short_term_borrowings', 0):,.2f}
- Bank loans non-current: {tb_data.get('long_term_borrowings', 0):,.2f}
- Total borrowings: {tb_data.get('total_borrowings', 0):,.2f}
- Interest expense: {tb_data.get('interest_expense', 0):,.2f}
- Weighted average interest rate: {tb_data.get('avg_interest_rate', 5.5):.1f}%

Generate:
6.1 Borrowings table:
    Current / Non-current split
    Secured / Unsecured classification

6.2 Maturity analysis:
    Within 1 year | 1-2 years | 2-5 years | Over 5 years

6.3 Security provided (assets pledged)

6.4 Covenants — any financial covenants to disclose

6.5 Reconciliation of financing liabilities
    (IAS 7.44A cash flow reconciliation)

Reference IAS 1.61, IFRS 7.7, IAS 7.44A.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=600)


def generate_n7_tax(tb_data: dict) -> str:
    pbt = tb_data.get("profit_before_tax", 0)
    tax_rate = tb_data.get("tax_rate", 25)
    tax_expense = tb_data.get("income_tax_expense", pbt * tax_rate / 100)
    deferred_tax = tb_data.get("deferred_tax_liability", 0)

    prompt = f"""
Generate Note 7 — Income Tax (IAS 12)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Numbers ({tb_data.get('currency', 'USD')}):
- Profit before tax: {pbt:,.2f}
- Applicable tax rate: {tax_rate}%
- Current tax expense: {tax_expense:,.2f}
- Deferred tax (credit)/charge: {tb_data.get('deferred_tax_charge', 0):,.2f}
- Total income tax expense: {tax_expense:,.2f}
- Deferred tax liability (BS): {deferred_tax:,.2f}

Generate:
7.1 Tax reconciliation table:
    Accounting profit × tax rate
    + Non-deductible expenses
    − Tax-exempt income
    = Income tax expense

7.2 Current vs Deferred tax split

7.3 Deferred tax liability movement:
    Opening | Charge | Closing
    Analysed by: Accelerated depreciation | Other

7.4 Unrecognised deferred tax assets (if any)

Reference IAS 12.81.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=600)


def generate_n8_related_parties(tb_data: dict) -> str:
    prompt = f"""
Generate Note 8 — Related Party Transactions (IAS 24)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Company context:
- Related parties disclosed: {tb_data.get('related_parties', [])}
- Director remuneration: {tb_data.get('director_remuneration', 0):,.2f}
- Currency: {tb_data.get('currency', 'USD')}

Generate:
8.1 Identity of related parties:
    - Parent company (if any)
    - Key management personnel
    - Other related entities

8.2 Transactions with related parties table:
    Entity | Relationship | Nature | Amount | O/S Balance

8.3 Key Management Personnel Compensation:
    Short-term benefits | Post-employment | Share-based

8.4 Terms and conditions:
    - Arm's length basis statement
    - Security provided (if any)

If no related party data provided, generate a
standard disclosure stating transactions were on
arm's length terms.

Reference IAS 24.17-24.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=500)


def generate_n9_contingencies(tb_data: dict) -> str:
    prompt = f"""
Generate Note 9 — Contingent Liabilities and Commitments (IAS 37)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Context:
- Legal proceedings disclosed: {tb_data.get('legal_proceedings', [])}
- Capital commitments: {tb_data.get('capital_commitments', 0):,.2f}
- Operating lease commitments (pre IFRS 16): 0
- Currency: {tb_data.get('currency', 'USD')}

Generate:
9.1 Contingent Liabilities:
    - Legal proceedings (if any)
    - Tax disputes (if any)
    - Guarantees given

9.2 Capital Commitments:
    - Contracted but not provided for
    - Authorised but not contracted

9.3 If no contingencies:
    "The Directors are not aware of any contingent
     liabilities that would have a material effect
     on the financial statements."

Reference IAS 37.86, IAS 16.74(c).
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=400)


def generate_n10_subsequent_events(tb_data: dict) -> str:
    prompt = f"""
Generate Note 10 — Events After the Reporting Date (IAS 10)
for {tb_data.get('company_name')} period ended {tb_data.get('period_end')}.

Context:
- Subsequent events disclosed: {tb_data.get('subsequent_events', [])}
- Financial statements approved date: {tb_data.get('approval_date', '[DATE]')}

Generate:
10.1 If events provided — describe adjusting vs
     non-adjusting events per IAS 10.3

10.2 Standard closing paragraph:
    "The Board of Directors approved these financial
     statements for issue on [approval_date].
     The Board has the power to amend the financial
     statements after issue.

     No other material events have occurred between
     the reporting date and the date of approval
     that would require adjustment to or disclosure
     in these financial statements."

Reference IAS 10.17, IAS 10.21.
"""
    return invoke(prompt=prompt, system=DISCLOSURE_SYSTEM, max_tokens=400)


def generate_all_notes(trial_balance_id: int, tb_data: dict, db: Session) -> dict:
    """Generate all 10 notes, persist to DB, return summary dict."""
    tb = db.query(TrialBalance).filter(TrialBalance.id == trial_balance_id).first()
    if not tb:
        raise ValueError("Trial balance not found")

    for n in db.query(DisclosureNote).filter(DisclosureNote.trial_balance_id == trial_balance_id).all():
        db.delete(n)
    db.flush()

    generators = [
        ("N1", "Significant Accounting Policies", generate_n1_accounting_policies),
        ("N2", "Property Plant and Equipment", generate_n2_fixed_assets),
        ("N3", "Leases", generate_n3_leases),
        ("N4", "Financial Instruments", generate_n4_financial_instruments),
        ("N5", "Revenue", generate_n5_revenue),
        ("N6", "Borrowings", generate_n6_borrowings),
        ("N7", "Income Tax", generate_n7_tax),
        ("N8", "Related Party Transactions", generate_n8_related_parties),
        ("N9", "Contingent Liabilities", generate_n9_contingencies),
        ("N10", "Events After Reporting Date", generate_n10_subsequent_events),
    ]

    results: dict[str, dict] = {}

    for i, (code, title, fn) in enumerate(generators, 1):
        try:
            content = fn(tb_data)
        except Exception as e:
            content = f"[Generation error: {e!s}]"

        note = DisclosureNote(
            tenant_id=tb.tenant_id,
            trial_balance_id=trial_balance_id,
            note_number=i,
            note_code=code,
            note_title=title,
            status=DisclosureNoteStatus.ai_draft,
            ai_generated_content=content,
            user_edited_content=content,
            is_user_edited=False,
            word_count=len(content.split()),
            generated_at=datetime.utcnow(),
        )
        db.add(note)
        db.flush()
        results[code] = {
            "id": note.id,
            "note_number": i,
            "code": code,
            "title": title,
            "content": content,
            "word_count": note.word_count,
            "status": DisclosureNoteStatus.ai_draft.value,
        }

    db.commit()
    return results
