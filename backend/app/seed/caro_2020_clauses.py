"""CARO 2020 (Companies (Auditor's Report) Order, 2020) — the 21 matters in paragraph 3.

Descriptions condense the Order's wording for each clause and its sub-clauses; the
notified Order issued by the Ministry of Corporate Affairs on 25 February 2020 is the
authoritative text. Synced at startup by clause number, so edits here reach existing
databases on the next deploy.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.internal_audit import AuditCaroClause

CLAUSES: list[dict[str, str]] = [
    {
        "clause_no": "3(i)",
        "matter": "Property, Plant and Equipment and Intangible Assets",
        "description": (
            "(a)(A) Whether the company is maintaining proper records showing full particulars, including "
            "quantitative details and situation, of Property, Plant and Equipment; (B) whether it is maintaining "
            "proper records showing full particulars of intangible assets. "
            "(b) Whether Property, Plant and Equipment have been physically verified by the management at "
            "reasonable intervals; whether any material discrepancies were noticed and, if so, whether they have "
            "been properly dealt with in the books of account. "
            "(c) Whether the title deeds of all immovable properties (other than properties where the company is "
            "the lessee and the lease agreements are duly executed in favour of the lessee) disclosed in the "
            "financial statements are held in the name of the company; if not, provide the prescribed details. "
            "(d) Whether the company has revalued its Property, Plant and Equipment (including right-of-use assets) "
            "or intangible assets or both during the year and, if so, whether the revaluation is based on the "
            "valuation by a Registered Valuer; specify the amount of change if it is 10% or more in the aggregate "
            "of the net carrying value of each class. "
            "(e) Whether any proceedings have been initiated or are pending against the company for holding any "
            "benami property under the Benami Transactions (Prohibition) Act, 1988 and the rules made thereunder; "
            "if so, whether the company has appropriately disclosed the details in its financial statements."
        ),
    },
    {
        "clause_no": "3(ii)",
        "matter": "Inventory and Working Capital Limits",
        "description": (
            "(a) Whether physical verification of inventory has been conducted at reasonable intervals by the "
            "management; whether, in the auditor's opinion, the coverage and procedure of such verification is "
            "appropriate; whether any discrepancies of 10% or more in the aggregate for each class of inventory "
            "were noticed and, if so, whether they have been properly dealt with in the books of account. "
            "(b) Whether during any point of time of the year the company has been sanctioned working capital "
            "limits in excess of five crore rupees, in aggregate, from banks or financial institutions on the "
            "basis of security of current assets; if so, whether the quarterly returns or statements filed by the "
            "company with such banks or financial institutions are in agreement with the books of account; if not, "
            "give details."
        ),
    },
    {
        "clause_no": "3(iii)",
        "matter": "Investments, Guarantees, Security and Loans Granted",
        "description": (
            "Whether during the year the company has made investments in, provided any guarantee or security, or "
            "granted any loans or advances in the nature of loans, secured or unsecured, to companies, firms, "
            "Limited Liability Partnerships or any other parties. If so: "
            "(a) the aggregate amount during the year and the balance outstanding at the balance sheet date, "
            "separately for subsidiaries, joint ventures and associates and for other parties (not applicable to "
            "companies whose principal business is to give loans); "
            "(b) whether the investments made, guarantees provided, security given and the terms and conditions "
            "of the grant of all loans and advances in the nature of loans and guarantees provided are not "
            "prejudicial to the company's interest; "
            "(c) whether the schedule of repayment of principal and payment of interest has been stipulated and "
            "whether the repayments or receipts are regular; "
            "(d) if any amount is overdue, the total amount overdue for more than ninety days and whether "
            "reasonable steps have been taken for recovery of the principal and interest; "
            "(e) whether any loan or advance in the nature of loan granted which has fallen due during the year "
            "has been renewed or extended, or fresh loans granted to settle the overdues of existing loans given "
            "to the same parties; if so, the aggregate amount and its percentage of the total loans granted; "
            "(f) whether the company has granted any loans or advances in the nature of loans either repayable on "
            "demand or without specifying any terms or period of repayment; if so, the aggregate amount, its "
            "percentage to the total loans granted, and the aggregate amount granted to Promoters and related "
            "parties as defined in section 2(76) of the Companies Act, 2013."
        ),
    },
    {
        "clause_no": "3(iv)",
        "matter": "Loans to Directors and Investments — Sections 185 and 186",
        "description": (
            "In respect of loans, investments, guarantees and security, whether the provisions of sections 185 and "
            "186 of the Companies Act, 2013 have been complied with; if not, provide the details thereof."
        ),
    },
    {
        "clause_no": "3(v)",
        "matter": "Deposits",
        "description": (
            "In respect of deposits accepted by the company or amounts which are deemed to be deposits, whether "
            "the directives issued by the Reserve Bank of India and the provisions of sections 73 to 76 or any "
            "other relevant provisions of the Companies Act, 2013 and the rules made thereunder, where applicable, "
            "have been complied with; if not, the nature of the contraventions. If an order has been passed by "
            "the Company Law Board, National Company Law Tribunal, Reserve Bank of India, any court or any other "
            "tribunal, whether the same has been complied with."
        ),
    },
    {
        "clause_no": "3(vi)",
        "matter": "Cost Records",
        "description": (
            "Whether maintenance of cost records has been specified by the Central Government under sub-section "
            "(1) of section 148 of the Companies Act, 2013 and, if so, whether such accounts and records have been "
            "so made and maintained."
        ),
    },
    {
        "clause_no": "3(vii)",
        "matter": "Statutory Dues",
        "description": (
            "(a) Whether the company is regular in depositing undisputed statutory dues, including Goods and "
            "Services Tax, provident fund, employees' state insurance, income-tax, sales-tax, service tax, duty of "
            "customs, duty of excise, value added tax, cess and any other statutory dues, with the appropriate "
            "authorities; if not, the extent of the arrears outstanding as at the last day of the financial year "
            "for a period of more than six months from the date they became payable. "
            "(b) Where statutory dues referred to in (a) have not been deposited on account of any dispute, the "
            "amounts involved and the forum where the dispute is pending (a mere representation to the concerned "
            "department is not a dispute)."
        ),
    },
    {
        "clause_no": "3(viii)",
        "matter": "Unrecorded Income Disclosed in Tax Assessments",
        "description": (
            "Whether any transactions not recorded in the books of account have been surrendered or disclosed as "
            "income during the year in the tax assessments under the Income Tax Act, 1961; if so, whether the "
            "previously unrecorded income has been properly recorded in the books of account during the year."
        ),
    },
    {
        "clause_no": "3(ix)",
        "matter": "Repayment of Borrowings and Use of Funds",
        "description": (
            "(a) Whether the company has defaulted in repayment of loans or other borrowings or in the payment of "
            "interest thereon to any lender; if so, the period and amount of default. "
            "(b) Whether the company is a declared wilful defaulter by any bank, financial institution or other "
            "lender. "
            "(c) Whether term loans were applied for the purpose for which the loans were obtained; if not, the "
            "amount diverted and the purpose for which it was used. "
            "(d) Whether funds raised on a short-term basis have been utilised for long-term purposes; if so, the "
            "nature and amount. "
            "(e) Whether the company has taken any funds from any entity or person on account of or to meet the "
            "obligations of its subsidiaries, associates or joint ventures; if so, the details. "
            "(f) Whether the company has raised loans during the year on the pledge of securities held in its "
            "subsidiaries, joint ventures or associate companies; if so, the details and any default in repayment."
        ),
    },
    {
        "clause_no": "3(x)",
        "matter": "Public Offers, Preferential Allotment and Private Placement",
        "description": (
            "(a) Whether moneys raised by way of initial public offer or further public offer (including debt "
            "instruments) during the year were applied for the purposes for which they were raised; if not, the "
            "details together with delays or default and subsequent rectification, if any. "
            "(b) Whether the company has made any preferential allotment or private placement of shares or "
            "convertible debentures (fully, partially or optionally convertible) during the year; if so, whether "
            "the requirements of sections 42 and 62 of the Companies Act, 2013 have been complied with and the "
            "funds raised have been used for the purposes for which they were raised; if not, the details of the "
            "amount involved and the nature of non-compliance."
        ),
    },
    {
        "clause_no": "3(xi)",
        "matter": "Fraud and Whistle-blower Complaints",
        "description": (
            "(a) Whether any fraud by the company or any fraud on the company has been noticed or reported during "
            "the year; if so, the nature and the amount involved. "
            "(b) Whether any report under sub-section (12) of section 143 of the Companies Act, 2013 has been "
            "filed by the auditors in Form ADT-4 as prescribed under rule 13 of the Companies (Audit and Auditors) "
            "Rules, 2014 with the Central Government. "
            "(c) Whether the auditor has considered whistle-blower complaints, if any, received during the year by "
            "the company."
        ),
    },
    {
        "clause_no": "3(xii)",
        "matter": "Nidhi Company",
        "description": (
            "(a) Whether the Nidhi Company has complied with the Net Owned Funds to Deposits ratio of 1:20 to meet "
            "out the liability. "
            "(b) Whether the Nidhi Company is maintaining ten per cent unencumbered term deposits as specified in "
            "the Nidhi Rules, 2014 to meet out the liability. "
            "(c) Whether there has been any default in payment of interest on deposits or repayment thereof for "
            "any period; if so, the details."
        ),
    },
    {
        "clause_no": "3(xiii)",
        "matter": "Related Party Transactions",
        "description": (
            "Whether all transactions with related parties are in compliance with sections 177 and 188 of the "
            "Companies Act, 2013 where applicable, and whether the details have been disclosed in the financial "
            "statements as required by the applicable accounting standards."
        ),
    },
    {
        "clause_no": "3(xiv)",
        "matter": "Internal Audit System",
        "description": (
            "(a) Whether the company has an internal audit system commensurate with the size and nature of its "
            "business. "
            "(b) Whether the reports of the internal auditors for the period under audit were considered by the "
            "statutory auditor."
        ),
    },
    {
        "clause_no": "3(xv)",
        "matter": "Non-cash Transactions with Directors",
        "description": (
            "Whether the company has entered into any non-cash transactions with directors or persons connected "
            "with them and, if so, whether the provisions of section 192 of the Companies Act, 2013 have been "
            "complied with."
        ),
    },
    {
        "clause_no": "3(xvi)",
        "matter": "Registration under Section 45-IA of the RBI Act",
        "description": (
            "(a) Whether the company is required to be registered under section 45-IA of the Reserve Bank of India "
            "Act, 1934 and, if so, whether the registration has been obtained. "
            "(b) Whether the company has conducted any Non-Banking Financial or Housing Finance activities without "
            "a valid Certificate of Registration from the Reserve Bank of India. "
            "(c) Whether the company is a Core Investment Company as defined in the regulations made by the Reserve "
            "Bank of India; if so, whether it continues to fulfil the criteria of a CIC and, in the case of an "
            "exempted or unregistered CIC, whether it continues to fulfil such criteria. "
            "(d) Whether the Group has more than one CIC as part of the Group; if so, the number of CICs which are "
            "part of the Group."
        ),
    },
    {
        "clause_no": "3(xvii)",
        "matter": "Cash Losses",
        "description": (
            "Whether the company has incurred cash losses in the financial year and in the immediately preceding "
            "financial year; if so, state the amount of cash losses."
        ),
    },
    {
        "clause_no": "3(xviii)",
        "matter": "Resignation of Statutory Auditors",
        "description": (
            "Whether there has been any resignation of the statutory auditors during the year; if so, whether the "
            "auditor has taken into consideration the issues, objections or concerns raised by the outgoing "
            "auditors."
        ),
    },
    {
        "clause_no": "3(xix)",
        "matter": "Material Uncertainty on Meeting Liabilities",
        "description": (
            "On the basis of the financial ratios, ageing and expected dates of realisation of financial assets "
            "and payment of financial liabilities, other information accompanying the financial statements, the "
            "auditor's knowledge of the Board of Directors and management plans, whether the auditor is of the "
            "opinion that no material uncertainty exists as on the date of the audit report that the company is "
            "capable of meeting its liabilities existing at the date of the balance sheet as and when they fall "
            "due within a period of one year from the balance sheet date."
        ),
    },
    {
        "clause_no": "3(xx)",
        "matter": "Corporate Social Responsibility — Unspent Amounts",
        "description": (
            "(a) Whether, in respect of other than ongoing projects, the company has transferred the unspent amount "
            "to a Fund specified in Schedule VII to the Companies Act, 2013 within a period of six months of the "
            "expiry of the financial year in compliance with the second proviso to sub-section (5) of section 135. "
            "(b) Whether any amount remaining unspent under sub-section (5) of section 135, pursuant to any "
            "ongoing project, has been transferred to a special account in compliance with sub-section (6) of "
            "section 135."
        ),
    },
    {
        "clause_no": "3(xxi)",
        "matter": "Qualifications in CARO Reports of Group Companies",
        "description": (
            "Whether there have been any qualifications or adverse remarks by the respective auditors in the "
            "Companies (Auditor's Report) Order reports of the companies included in the consolidated financial "
            "statements; if so, indicate the details of the companies and the paragraph numbers of the CARO report "
            "containing the qualifications or adverse remarks. Reported only in the auditor's report on "
            "consolidated financial statements."
        ),
    },
]


def seed_caro_clauses(db: Session) -> None:
    """Insert missing clauses and refresh wording of existing ones, matched by clause number."""
    existing = {c.clause_no: c for c in db.query(AuditCaroClause).all()}
    changed = False
    for order, data in enumerate(CLAUSES, start=1):
        row = existing.get(data["clause_no"])
        if row is None:
            db.add(AuditCaroClause(**data, sort_order=order))
            changed = True
            continue
        for key, value in {**data, "sort_order": order}.items():
            if getattr(row, key) != value:
                setattr(row, key, value)
                changed = True
    if changed:
        db.commit()
