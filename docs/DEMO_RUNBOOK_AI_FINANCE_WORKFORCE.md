# Demo runbook — "The Future of Finance: Multi-Agent AI Workforce"

A 20-minute live demonstration for CFOs, controllers and finance transformation leaders, run on the
real application with the synthetic demo group. Every screen and figure below exists in the product
today. Figures are those produced by the full-volume demo data for an October 2026 close; if you load
the demo in a later month the period shifts but the planted issues and amounts stay the same (days
overdue vary slightly).

**Positioning line:** *From individual finance automation to an AI finance workforce — specialised agents
across reconciliation, AP, AR, IFRS, FP&A, investments and consolidation, coordinated by NEXUS, with every
journal approved by a human.*

---

## 1. Before the meeting (30 minutes, the day before)

| # | Check | Where |
|---|---|---|
| 1 | Log in as an **owner** (needed to approve journals, the close and the controls) | Login |
| 2 | Rebuild the demo: **Load the synthetic demo group** (resets journals, approvals and the period lock; takes up to a minute) | Executive Hub → Month-End Close (AI) |
| 3 | Switch the company banner to **Gnanova Demo Trading LLC (synthetic data)** | Top banner |
| 4 | Approval controls: leave **segregation of duties off** for a one-person demo (with it on, the person who starts the close can't approve it) | Month-End Close → Approval controls and policies |
| 5 | Do one full rehearsal of sections 3–6, then **rebuild the demo again** so the meeting starts clean | — |
| 6 | Optional: `ANTHROPIC_API_KEY` set on Render → agent answers and CFO commentary are AI-drafted (and verified). Without it the computed answers are shown — still correct, less conversational | Render → Environment |
| 7 | Optional: email set up (SMTP or Resend + `FRONTEND_URL`) and your address added to the schedule, to show the emailed CFO summary | Render; Scheduled close card |
| 8 | Download the CFO Executive Summary PDF and the AP Processing Report from the rehearsal run as a **backup** in case the network fails | Finance Deliverables |
| 9 | Browser zoom 90%, close other tabs, notifications off | — |

Open these tabs in order: **AI Finance Workforce**, **Month-End Close (AI)**.

---

## 2. Opening — introduce the workforce (minutes 0–2)

**Screen:** Executive Hub → **AI Finance Workforce**.

**Say:**
> "Most finance teams run on an ERP plus spreadsheets, email and manual checks. Today I'm not going to
> show you a software tour. I'm going to introduce you to a finance workforce: nine specialised agents —
> reconciliation, payables, receivables, IFRS, FP&A, investments, consolidation, a close manager and a CFO
> intelligence agent — coordinated by an orchestrator we call NEXUS."

Point to the three statements under the header:
> "Three rules this workforce never breaks: every number is computed from your records, never generated;
> agents prepare journals but only a finance manager can approve and post; and no agent's work counts as
> done until its output passes validation checks."

---

## 3. Individual agents (minutes 2–9)

Use **Ask this agent** on each card. The request box is pre-filled; click **Run agent**. Each run takes a
few seconds and genuinely executes the agent on the ledger.

### 3a. Reconciliation Agent (≈2 min)

**Prompt (pre-filled):** "Perform October bank reconciliation. Match bank transactions with GL entries,
identify unmatched transactions, investigate potential duplicates and prepare a reconciliation summary."

**What appears:** 1,015 statement lines, 1,012 matched, 5 exceptions:

| Item | Amount | What it is |
|---|---|---|
| Cash deposit – unidentified | +8,750.00 | Bank-only; needs investigation |
| Meridian Advisory cheque (DEMO-JE-…-20) | −68,000.00 | Ledger-only; cheque not yet cleared |
| Utilities (DEMO-JE-…-21) | −6,014.00 | Ledger-only; the DEWA bill was **posted twice** |
| SWIFT transfer charges | −450.00 | Bank-only → journal proposed |
| Profit credit on call account | +1,250.00 | Bank-only → journal proposed |

**Say:** "A thousand card settlements matched in seconds. It didn't just match lines — it explained the
difference between the bank and the ledger, spotted the duplicate posting, and drafted the two journals the
evidence supports. Notice they are *previews*: nothing is created until we run the close."

Click **View** on the Bank Reconciliation Report → show accounts, reconciling items, proposed journals.

### 3b. AP Agent (≈2.5 min)

**Prompt (pre-filled):** "Process the October supplier invoices. Validate VAT and supplier details, perform
PO and GRN matching, identify duplicates and prepare an AP exception report and payment proposal."

**What appears:** 257 October supplier invoices — 250 three-way matched — and 7 exceptions:

| Exception | Detail |
|---|---|
| Price mismatch | Gulf IT Solutions GIT-4471: invoiced 18,000 net vs PO/GRN 15,000 |
| Duplicate invoice | **"GIT 4471"** — the same invoice re-keyed with a space; held from payment |
| Possible duplicate | DEWA DW-7710 and DW-7714 — same amount, two days apart |
| Vendor mismatch | "Gulf Tech Trading" invoiced against a Gulf IT Solutions PO |
| No purchase order | Prime Events Management 12,600 net |
| Awaiting goods receipt | GIT-4480 — invoice before the laptops were received |
| **Received, not invoiced** | **HVAC overhaul 50,000** — accrual: Dr 7180 Repairs & Maintenance / Cr 3020 Accrued Expenses |

**Say:** "This is the control layer a CFO cares about: it caught a re-keyed duplicate that a person would
pay, held every questionable invoice out of the payment run, and noticed 50,000 of repairs we've received
but not been billed for — so October's costs are complete. Next month it proposes reversing that accrual
so the cost isn't counted twice when the invoice arrives."

Click **View** on the AP Processing Report → Invoice register, PO and GRN matching, Payment proposals
(note "not executed").

*Where invoices come from:* supplier invoices are captured in **AP InvoiceFlow** (upload or email intake,
with AI extraction). If asked, show it separately; the AP Agent reads what's captured there.

### 3c. IFRS Agent (≈2.5 min)

**First switch the banner to Gnanova Demo Services FZ-LLC (synthetic data).** (Switch back afterwards.)

**Prompt (pre-filled):** "Review October lease accounting under IFRS 16 and the expected credit loss under
IFRS 9…"

**What appears:** 8 accounting checks for this entity. The agent finds:
- **IFRS 16:** the office lease's October **depreciation and interest** are not recorded (the payment
  was) → proposes both entries from the lease schedule.
- **IAS 19:** salaries charged with **no end-of-service accrual** → proposes it at 21 days per year.
- **IFRS 9:** receivables aged through a provision matrix → allowance top-up proposed. (Loss rates are the
  defaults unless set under *Approval controls and policies*.)
- Statement integrity (trial balance, balance sheet, chart-of-accounts coverage) and revenue cut-off pass.

**Say:** "This is accounting judgement applied consistently every month: the standard, the calculation and
the rationale are on every proposed entry, ready for review."

Click **View** on the IFRS Accounting Pack → accounting checks, ECL provision matrix, lease register and
maturity analysis.

### 3d. Investment Agent (optional, ≈1.5 min) — on Gnanova Demo Trading LLC

**Prompt (pre-filled):** "Analyse the company's investment portfolio for October…"

**What appears:** 6 holdings worth **1,270,500.00**; October fair value movement **+8,000 (FVTPL)** and
**+4,000 (FVOCI)** not yet in the ledger → two fair value journals proposed (Dr 2040 Investments / Cr 6030
and Cr 5030). Flags: **Emirates NBD 33.1%** of the portfolio (limit 25%), **Aldar down 12.0%** in the month,
and the **Mashreq deposit maturing in November**.

**Say:** "Treasury gets the same discipline: valuation, IFRS 9 classification, concentration against policy
and the accounting entries — all prepared, none posted."

*(Optional, if time: FP&A Agent — Professional Fees 674% over budget and Travel 217% over, a rolling
12-month forecast in base/best/worst case, and the 30/60/90-day cash forecast. AR Agent — Northgate
Contracting 90+ days overdue.)*

---

## 4. The agents working together — month-end close (minutes 9–14)

**Switch the banner back to Gnanova Demo Trading LLC.** Click **Run the full month-end close** (top
right), or open Executive Hub → **Month-End Close (AI)**.

In **Run Month-End Close**: *Consolidated group* is pre-selected with both subsidiaries ticked and all six
agents checked. Click **Run Month-End Close**.

**Say while it runs (≈20–30 s):**
> "One instruction: close October for the group. NEXUS plans the work by dependency. Reconciliation,
> payables, receivables and investments start together; IFRS waits for receivables because expected
> credit loss needs the ageing; FP&A waits for receivables and payables because the cash forecast needs
> both. Then consolidation, the close manager and finally the CFO intelligence agent. Each runs per company
> and the results are merged with the company tagged."

Scroll to **Execution sequence** → show the real steps and timing bars, then the agent cards.

Expected results (group of three):

| KPI | Value |
|---|---|
| Bank transactions processed / reconciled / unmatched | 1,028 / 1,025 / 5 |
| AP invoices processed / AP exceptions | 317 / 7 |
| AR overdue invoices | 4 |
| IFRS checks completed | 22 |
| Exceptions identified (unique) | 28 |
| Pending journal approvals | 13 |
| Agents executed | 9 |

**Say:** "Exceptions are de-duplicated — 28 unique issues, never counted twice — and every KPI has a
written definition you can hover over."

**Consolidation:** point to the exception "Intercompany mismatch IC-2026-10-01: Services 25,000 vs
Logistics 24,000". "Services charged a 25,000 management fee; Logistics booked 24,000. The agent eliminated
the 24,000 both sides agree on and left the 1,000 visible until someone fixes it." If a subsidiary reported
in another currency, it would be translated at the month's average and closing rates (IAS 21).

---

## 5. What the CFO receives (minutes 14–17)

**CFO Executive Summary** (top of the run):
- Revenue 856,598 (sum of entities); **consolidated revenue 832,598** after 24,000 intercompany eliminated.
- 12-month outlook (base / best / worst profit), subsidiary comparison, financial risks (including
  investment concentration), root causes and actions, largest movements vs September.
- "Decisions required: 13 journals."

**Say:** "If an AI wrote this commentary, every figure in it was checked against the agents' results —
any number it can't trace is thrown away. The figures themselves are always computed."

**Finance Deliverables:** View one, download one:

| Deliverable | Agent |
|---|---|
| Bank Reconciliation Report | Reconciliation |
| AP Processing Report | AP |
| AR Ageing & Collection Report | AR |
| IFRS Accounting Pack | IFRS |
| FP&A Variance & Forecast Report (incl. rolling 12 months) | FP&A |
| Investment Review Report | Investment |
| Month-End Close Pack (with group results and eliminations) | Close Manager |
| CFO Executive Summary (PDF) | CFO Intelligence |

**Journal Approval Centre:** find **"Accrue Repairs & Maintenance 50,000.00 - goods received not invoiced"**.
Show the lines (Dr 7180 / Cr 3020), the source (GRN and PO), the rationale, then **Approve and post**.
> "The agent prepared it; the controller approves it. That's the control model."

Show **Request changes** on another journal (a note is required) to demonstrate the review loop.

**Controls:** point to *Approval controls and policies*: "In production you switch on segregation of duties —
the person who runs the close can't approve it — and set an approval limit so large journals need an owner."

**Close approval:** explain that approving the close locks October for all three companies — no further
postings. (Don't approve it in the meeting unless you want to show the lock; it needs every journal decided.)

**Scheduled close card:** "This can run itself on the 2nd of every month and email the CFO this summary
with the PDF attached — or post to Slack."

---

## 6. Closing (minutes 17–20)

> "At Gnanova, our vision is an agent-driven finance function: specialised agents that understand finance
> processes, work on your real data, collaborate, and hand the CFO decisions instead of spreadsheets.
> Not replacing finance professionals — removing repetitive work, strengthening controls and accelerating
> the close. You can start with one agent, such as reconciliation or AP, or deploy the connected workforce."

Offer next step: a pilot on one entity's October data.

---

## 7. Likely questions — honest answers

| Question | Answer |
|---|---|
| "Is the AI making these numbers up?" | No. Every figure is calculated from ledger, bank, invoice, lease and portfolio records. AI only drafts wording, and it's discarded if it cites any figure not in the results. |
| "Does it post to our books automatically?" | Never. Agents prepare journals as *pending approval*; only an owner or finance manager can approve and post. Approving the close locks the period. |
| "Can the person who runs the close approve it?" | Not if segregation of duties is on. Approval limits route large journals to an owner. Every decision is in the audit log. |
| "What if an agent fails?" | It's retried once, then shown as Failed; other agents carry on and report what they couldn't use. The close can't be approved with a failed agent. |
| "Which ERP does it connect to?" | It works on the platform's ledger (UAE ledger), bank statements, AR invoices, AP InvoiceFlow and the investment register (CSV import). Data can be imported from ERPs/CSV; deep connectors are scoped per client. |
| "Can it do group consolidation?" | Yes — per-entity results, intercompany elimination using a shared IC reference, subsidiary comparison, and IAS 21 translation of foreign-currency entities using the month's rates you enter. |
| "Investment / treasury?" | Yes — the Investment Agent values the portfolio from recorded month-end prices, applies IFRS 9 categories, checks concentration limits and proposes fair value journals. It doesn't fetch live market prices. |
| "Rolling 12-month forecast?" | Yes — the FP&A agent projects 12 months per account (run rate plus damped trend) in base, best and worst case. No seasonality adjustment yet. |
| "India / GST?" | This demo is on the UAE ledger (VAT). |
| "Who can see and do what?" | Workspace roles: viewers read, accountants run, finance managers and owners approve; only owners change controls. |

---

## 8. If something goes wrong

| Symptom | Fix during the meeting |
|---|---|
| AP shows "AP invoices could not be read" | Supabase unreachable — continue; mention the agent reports missing data instead of guessing. Use the backup AP PDF. |
| Answers say "computed answer shown" | No Anthropic key — fine; the content is the same. |
| "Close run #… is still running" | Wait 20–30 seconds and refresh. |
| "Segregation of duties" error on approval | Controls are on — switch them off for the demo, or approve as a second user. |
| Numbers differ from this runbook | The demo was used before the meeting — rebuild it (Load the synthetic demo group) and rerun. |
| Journal approval fails with a period message | The period was locked in a rehearsal — rebuild the demo. |

**Do not claim** in the meeting: GST validation, live market-data feeds, seasonality in forecasts,
automatic posting, or ERP connectors that aren't set up for the prospect.
