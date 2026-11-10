# Demo runbook — "The Future of Finance: Multi-Agent AI Workforce"

A 20-minute live demonstration for CFOs, controllers and finance transformation leaders, run on the
real application with the synthetic demo group. Every screen and figure below exists in the product
today. Figures are those produced by the demo data for an October 2026 close; if you load the demo in
a later month the period shifts but the planted issues and amounts stay the same (days overdue vary
slightly).

**Positioning line:** *From individual finance automation to an AI finance workforce — specialised agents
across reconciliation, AP, AR, IFRS, FP&A and consolidation, coordinated by NEXUS, with every journal
approved by a human.*

---

## 1. Before the meeting (30 minutes, the day before)

| # | Check | Where |
|---|---|---|
| 1 | Log in as an **owner or finance manager** (needed to approve journals and the close) | Login |
| 2 | Rebuild the demo: **Load the synthetic demo group** (resets journals, approvals and the period lock) | Executive Hub → Month-End Close (AI) |
| 3 | Switch the company banner to **Gnanova Demo Trading LLC (synthetic data)** | Top banner |
| 4 | Do one full rehearsal of sections 3–6, then **rebuild the demo again** so the meeting starts clean | — |
| 5 | Optional: `ANTHROPIC_API_KEY` set on Render → agent answers and CFO commentary are AI-drafted (and verified). Without it the computed answers are shown — still correct, less conversational | Render → Environment |
| 6 | Optional: email set up (SMTP or Resend + `FRONTEND_URL`) and your address added to the schedule, to show the emailed CFO summary | Render; Scheduled close card |
| 7 | Download the CFO Executive Summary PDF and the AP Processing Report from the rehearsal run as a **backup** in case the network fails | Finance Deliverables |
| 8 | Browser zoom 90%, close other tabs, notifications off | — |

Open these tabs in order: **AI Finance Workforce**, **Month-End Close (AI)**.

---

## 2. Opening — introduce the workforce (minutes 0–2)

**Screen:** Executive Hub → **AI Finance Workforce**.

**Say:**
> "Most finance teams run on an ERP plus spreadsheets, email and manual checks. Today I'm not going to
> show you a software tour. I'm going to introduce you to a finance workforce: eight specialised agents —
> reconciliation, payables, receivables, IFRS, FP&A, consolidation, a close manager and a CFO intelligence
> agent — coordinated by an orchestrator we call NEXUS."

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

**What appears:** 55 statement lines, 52 matched, 5 exceptions:

| Item | Amount | What it is |
|---|---|---|
| Cash deposit – unidentified | +8,750.00 | Bank-only; needs investigation |
| Meridian Advisory cheque (DEMO-JE-…-20) | −68,000.00 | Ledger-only; cheque not yet cleared |
| Utilities (DEMO-JE-…-21) | −6,014.00 | Ledger-only; the DEWA bill was **posted twice** |
| SWIFT transfer charges | −450.00 | Bank-only → journal proposed |
| Profit credit on call account | +1,250.00 | Bank-only → journal proposed |

**Say:** "It didn't just match lines — it explained the difference between the bank and the ledger, spotted
the duplicate posting, and drafted the two journals the evidence supports. Notice they are *previews*:
nothing is created until we run the close."

Click **View** on the Bank Reconciliation Report → show accounts, reconciling items, proposed journals.

### 3b. AP Agent (≈2.5 min)

**Prompt (pre-filled):** "Process the October supplier invoices. Validate VAT and supplier details, perform
PO and GRN matching, identify duplicates and prepare an AP exception report and payment proposal."

**What appears:** 47 October supplier invoices — 40 three-way matched — and 7 exceptions:

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
but not been billed for — so October's costs are complete."

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
- **IFRS 9:** receivables aged through a provision matrix → allowance top-up proposed.
- Statement integrity (trial balance, balance sheet, chart-of-accounts coverage) and revenue cut-off pass.

**Say:** "This is accounting judgement applied consistently every month: the standard, the calculation and
the rationale are on every proposed entry, ready for review."

Click **View** on the IFRS Accounting Pack → accounting checks, ECL provision matrix, lease register and
maturity analysis.

*(Optional, if time: FP&A Agent — Professional Fees 674% over budget and Travel 217% over, plus the
30/60/90-day cash forecast in three scenarios. AR Agent — Northgate Contracting 90+ days overdue.)*

---

## 4. The agents working together — month-end close (minutes 9–14)

**Switch the banner back to Gnanova Demo Trading LLC.** Click **Run the full month-end close** (top
right), or open Executive Hub → **Month-End Close (AI)**.

In **Run Month-End Close**: *Consolidated group* is pre-selected with both subsidiaries ticked and all five
agents checked. Click **Run Month-End Close**.

**Say while it runs (≈10–20 s):**
> "One instruction: close October for the group. NEXUS plans the work by dependency. Reconciliation,
> payables and receivables start together; IFRS waits for receivables because expected credit loss needs
> the ageing; FP&A waits for receivables and payables because the cash forecast needs both. Then
> consolidation, the close manager and finally the CFO intelligence agent. Each runs per company and the
> results are merged with the company tagged."

Scroll to **Execution sequence** → show the real steps and timing bars, then the agent cards.

Expected results (group of three):

| KPI | Value |
|---|---|
| Bank transactions processed / reconciled / unmatched | 68 / 65 / 5 |
| AP invoices processed / AP exceptions | 59 / 7 |
| AR overdue invoices | 4 |
| IFRS checks completed | 22 |
| Exceptions identified (unique) | 24 |
| Pending journal approvals | 11 |
| Agents executed | 8 |

**Say:** "Exceptions are de-duplicated — 24 unique issues, never counted twice — and every KPI has a
written definition you can hover over."

**Consolidation:** point to the exception "Intercompany mismatch IC-2026-10-01: Services 25,000 vs
Logistics 24,000". "Services charged a 25,000 management fee; Logistics booked 24,000. The agent eliminated
the 24,000 both sides agree on and left the 1,000 visible until someone fixes it."

---

## 5. What the CFO receives (minutes 14–17)

**CFO Executive Summary** (top of the run):
- Revenue 854,101 (sum of entities); **consolidated revenue 830,101** after 24,000 intercompany eliminated.
- Subsidiary comparison, financial risks, root causes and actions, largest movements vs September.
- "Decisions required: 11 journals."

**Say:** "If an AI wrote this commentary, every figure in it was checked against the agents' results —
any number it can't trace is thrown away. The figures themselves are always computed."

**Finance Deliverables:** View one, download one:

| Deliverable | Agent |
|---|---|
| Bank Reconciliation Report | Reconciliation |
| AP Processing Report | AP |
| AR Ageing & Collection Report | AR |
| IFRS Accounting Pack | IFRS |
| FP&A Variance & Forecast Report | FP&A |
| Month-End Close Pack (with group results and eliminations) | Close Manager |
| CFO Executive Summary (PDF) | CFO Intelligence |

**Journal Approval Centre:** find **"Accrue Repairs & Maintenance 50,000.00 - goods received not invoiced"**.
Show the lines (Dr 7180 / Cr 3020), the source (GRN and PO), the rationale, then **Approve and post**.
> "The agent prepared it; the controller approves it. That's the control model."

Show **Request changes** on another journal (a note is required) to demonstrate the review loop.

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
| "Is the AI making these numbers up?" | No. Every figure is calculated from ledger, bank, invoice and lease records. AI only drafts wording, and it's discarded if it cites any figure not in the results. |
| "Does it post to our books automatically?" | Never. Agents prepare journals as *pending approval*; only an owner or finance manager can approve and post. Approving the close locks the period. |
| "What if an agent fails?" | It's retried once, then shown as Failed; other agents carry on and report what they couldn't use. The close can't be approved with a failed agent. |
| "Which ERP does it connect to?" | It works on the platform's ledger (UAE ledger), bank statements, AR invoices and AP InvoiceFlow. Data can be imported from ERPs/CSV; deep connectors are scoped per client. |
| "Can it do group consolidation?" | Yes — per-entity results, intercompany elimination using a shared IC reference, subsidiary comparison. Currency translation for non-AED entities is flagged, not yet automated. |
| "Investment / treasury agent?" | On the roadmap; not part of today's workforce. |
| "Rolling 12-month forecast?" | Today the FP&A agent gives a 30/60/90-day cash forecast in three scenarios plus budget variance; the separate Forecasting module covers longer horizons. |
| "India / GST?" | This demo is on the UAE ledger (VAT). |
| "Who can see and do what?" | Workspace roles: viewers read, accountants run, finance managers and owners approve. Every decision is in the audit log. |

---

## 8. If something goes wrong

| Symptom | Fix during the meeting |
|---|---|
| AP shows "AP invoices could not be read" | Supabase unreachable — continue; mention the agent reports missing data instead of guessing. Use the backup AP PDF. |
| Answers say "computed answer shown" | No Anthropic key — fine; the content is the same. |
| "Close run #… is still running" | Wait 10–20 seconds and refresh. |
| Numbers differ from this runbook | The demo was used before the meeting — rebuild it (Load the synthetic demo group) and rerun. |
| Journal approval fails with a period message | The period was locked in a rehearsal — rebuild the demo. |

**Do not claim** in the meeting: an Investment Agent, a rolling 12-month forecast inside the FP&A agent,
GST validation, automatic posting, or ERP connectors that aren't set up for the prospect.
