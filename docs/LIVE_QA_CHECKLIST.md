# Live QA checklist — Gnanova Finance OS (AI Finance Workforce)

Production: frontend https://finreportaicommercial.vercel.app · API https://finreportaicommercial.onrender.com

Expected figures are for the **full-volume synthetic demo group**, October 2026 close. Every check
must verify behaviour and numbers, not just that the page renders. Record PASS / FAIL / BLOCKED with a
screenshot for each row.

**Change classes**
- **R** — read-only.
- **A** — authorized change on synthetic demo companies only (load demo, run closes/agent previews,
  small synthetic investment CSV).
- **P** — needs explicit approval on the day (journal decisions, controls/ECL changes, FX rates, extra
  test company). Record original values before, restore after.

---

## 0. Setup and global checks (every screen)

| # | Step | Expected | Class |
|---|---|---|---|
| 0.1 | Log in as an **Owner**; open `/ai-cfo/executive-summary` | Page loads; no console errors; all `/api/ai-close/*` calls 2xx | R |
| 0.2 | Month-End Close (AI) → **Load the synthetic demo group** → confirm | Banner switches to *Gnanova Demo Trading LLC (synthetic data)*; notice lists 3 entities; completes within ~60 s on Render | A |
| 0.3 | On every screen below: DevTools console | No red errors (React warnings noted separately) | R |
| 0.4 | On every screen: Network tab | No 4xx/5xx except intentional permission tests | R |
| 0.5 | On every screen: refresh (F5) | Same run, same figures (data persists server-side) | R |
| 0.6 | On every screen: DevTools device toolbar 390 px wide | No horizontal page scroll except inside tables; buttons reachable | R |
| 0.7 | Sidebar: Executive Hub → AI Finance Workforce, AI CFO Command Centre, Month-End Close (AI), Investment Portfolio | Each opens its page; active item highlighted; back button works | R |
| 0.8 | Login page: Tab to the eye icon | Screen reader / accessibility tree names it "Show password" / "Hide password" | R |
| 0.9 | Month-End Close: untick a subsidiary, then wait for / trigger a company-list refresh (switch tab and back) | Your group selection is kept | R |

## 1. Investment Portfolio and Investment Agent (priority)

| # | Step | Expected | Class |
|---|---|---|---|
| 1.1 | Executive Hub → **Investment Portfolio** | 6 holdings; total latest value **AED 1,270,500**; ENBD 420,000 · FAB 180,000 · ALDAR 132,000 · UAESK29 248,500 · MSQDEP 150,000 · GEQF 140,000; all "as of" 2026-10-31 | R |
| 1.2 | AI Finance Workforce → Investment Agent → **Ask this agent** → Run agent | Answer: "Reviewed 6 holding(s) worth 1,270,500.00"; month return ≈ **1.07%** | A |
| 1.3 | Same panel → View report (Investment Review Report) | Holdings, Asset allocation (equity **57.6%**), Issuer concentration (Emirates NBD **33.1%**), Currency exposure (USD ≈ 11%), Maturity ladder (Mashreq Nov 2026) | R |
| 1.4 | Same panel → proposed journals (preview) | **FVTPL gain 8,000** (Dr 2040 / Cr 6030) and **FVOCI gain 4,000** (Dr 2040 / Cr 5030); rationale cites IFRS 9 | R |
| 1.5 | Same panel → exceptions | Concentration (ENBD 33.1% > 25%), Aldar fell **12.0%**, Mashreq deposit matures in November, fair value 12,000 unrecorded | R |
| 1.6 | Recalculate by hand: ledger 2040 = 1,260,000 (Sep values + sukuk/deposit at cost); expected = 1,272,000; difference **12,000** = 8,000 + 4,000 | Matches the report's "Ledger 2040 / portfolio" line | R |
| 1.7 | Investment Portfolio → Template → import a 1-holding CSV on **Gnanova Demo Services FZ-LLC** (code `QA1`, bond, amortised_cost, cost 10000) plus a valuation | "1 holding(s) added … 1 valuation(s) saved"; row appears; persists after refresh | A |
| 1.8 | Import a CSV with an unknown asset class | Clear 422 error; nothing saved | A |
| 1.9 | Excel and PDF downloads of the Investment Review Report | Files open; Summary sheet shows entity, period, agent, "Agent preview" approval status | R |

## 2. FP&A rolling 12-month forecast (priority)

| # | Step | Expected | Class |
|---|---|---|---|
| 2.1 | Workforce → FP&A Agent → Ask (pre-filled prompt) | Answer mentions "Rolling 12 months: base profit … (best …, worst …)" | A |
| 2.2 | View FP&A report → **Rolling 12-month forecast** | 12 rows, **2026-11 → 2027-10**; best profit > base > worst in every month | R |
| 2.3 | Spot-check: best revenue = base × 1.05; worst costs = base × 1.05 (any month) | Within rounding | R |
| 2.4 | **Rolling forecast by account** | No 6030 (fair value), 7202 (FX) or 7190 (credit loss) lines; method note says they are not projected | R |
| 2.5 | Budget vs actual | Professional Fees **674%** over (67,240), Travel **217%** over (15,940) | R |
| 2.6 | Indicative cash column | Starts from period-end cash and moves by monthly profit | R |
| 2.7 | Month-End Close (AI) → **Forecast seasonality** card | Shows "No seasonality set" and twelve 1.00 values for revenue and expenses (demo default) — record it | R |
| 2.8 | Group close → FP&A task → 30/60/90-day cash forecast | Days read **30 / 60 / 90** (not 90 / 180 / 270) | R |
| 2.9 | Edit seasonality on the demo parent: revenue Nov 1.4, Feb 0.8 (others 1.0) → Save; re-run FP&A | Saved values rescaled to average 1; method note says "deseasonalised"; Nov revenue above Feb; restore with **Remove seasonality** | P |

## 3. Month-end close — group of three (priority: consolidated CFO dashboard)

| # | Step | Expected | Class |
|---|---|---|---|
| 3.1 | Month-End Close (AI) → Consolidated group pre-selected, 2 subsidiaries ticked, **6 agents** ticked → Run Month-End Close | Status runs → **awaiting approval** in ~30–90 s on Render; polling updates without refresh | A |
| 3.2 | KPI cards | Bank **1,028 / 1,025 / 5** · AP **317 / 7** · AR overdue **4** · IFRS checks **22** · Exceptions **28** · Unresolved **28** · Pending approvals **13** · Agents executed **9** | R |
| 3.3 | Hover KPI cards | Each shows its written definition | R |
| 3.4 | Execution sequence | Steps: (bank, AP, AR, investment) → (IFRS, FP&A) → consolidation → close manager → CFO; timing bars from actual start/finish | R |
| 3.5 | CFO Executive Summary | Revenue (sum) **856,598**; consolidated **832,598**; 24,000 intercompany eliminated; 12-month outlook sentence; subsidiary comparison 3 rows; risks include **Investments** | R |
| 3.6 | Check: 856,598 − 24,000 = 832,598 | Exact | R |
| 3.7 | Exceptions table filters: Unresolved / Resolved / All; by agent; Entity column present | Counts change consistently; 28 total | R |
| 3.8 | Finance Deliverables: View each of 8; download 1 Excel + CFO PDF | All open; CFO Summary has PDF only (Excel button absent) | R |
| 3.9 | Refresh page | Same run shown with same KPIs (latest run persisted) | R |

## 4. Approvals — segregation of duties

| # | Step | Expected | Class |
|---|---|---|---|
| 4.1 | Approval controls and policies card | Shows current values (expected: segregation off, no limit, default ECL rates) — record them | R |
| 4.2 | Turn segregation **on**, run a close, try to approve a journal as the same user | 403 "Segregation of duties: you started this close…"; close approval also blocked | P |
| 4.3 | Restore original controls | Card shows the recorded values | P |

## 5. Approvals — limits by amount

| # | Step | Expected | Class |
|---|---|---|---|
| 5.1 | Set finance-manager limit 1,000 (as owner) | Saved; Journal Approval Centre shows "Journals above AED 1,000 need an owner" | P |
| 5.2 | As a **finance manager** user: approve the 450 bank-charge journal, then the 1,250 interest journal | 450 posts; 1,250 → 403 "Above your approval limit of 1,000.00" | P |
| 5.3 | Restore limit | Original value | P |

## 6. Accrual reversals and protected entries

| # | Step | Expected | Class |
|---|---|---|---|
| 6.1 | In the October close, approve **Accrue Repairs & Maintenance 50,000.00** | Journal posted; GRNI exception → Resolved | P |
| 6.2 | Run a close for **2026-11** (agents AR + IFRS) | Proposal "Reverse 2026-10 accrual: …" dated **2026-11-01**, Dr 3020 / Cr 7180 50,000, reference `REV-…` | P |
| 6.3 | Approved end-of-service accrual from October | **Not** reversed | P |
| 6.4 | Re-run November after approving the reversal | No duplicate reversal | P |

## 7. IFRS 9 credit-loss rates

| # | Step | Expected | Class |
|---|---|---|---|
| 7.1 | Workforce → IFRS Agent (on Services FZ-LLC) → View IFRS Accounting Pack | ECL matrix uses defaults **1 / 3 / 8 / 20 / 50%**; note says "default loss rates" | R |
| 7.2 | Set rates 2 / 5 / 10 / 25 / 60% (parent) | Saved; IFRS pack on parent shows those rates and "company's provision-matrix loss rates" | P |
| 7.3 | Try decreasing rates (e.g. 61–90 lower than 31–60) or > 100% | Rejected with a clear message | P |
| 7.4 | Restore original rates (blank = defaults) | | P |

## 8. IAS 21 currency translation and exclusions

| # | Step | Expected | Class |
|---|---|---|---|
| 8.1 | Requires a company with base currency ≠ AED in the workspace (none in the demo) | If none: **BLOCKED** | P |
| 8.2 | Include it in a group close **without** rates | Exception "no 2026-10 USD/AED rates, so it is excluded from group totals"; comparison shows "(USD, not translated)" | P |
| 8.3 | Enter October closing/average (and September closing) in the Exchange rates card; re-run | Close Pack → "Currency translation into AED (IAS 21)" table; revenue at average rate, net assets at closing; share capital and retained earnings at historical rates; translation reserve column; consolidated BS balances | P |
| 8.4 | Same run → FP&A and AR task outputs | Group totals in AED: the USD company's figures × rate; its own entry still in USD; limitation names the rates used | P |
| 8.5 | Exchange rates card as a **finance manager** (not designated) | Inputs read-only: "rates are maintained by an owner or a designated treasury administrator"; API PUT → 403 | R |
| 8.6 | As owner: designate a treasury administrator email; as that user save a rate, then change it | Save succeeds; card shows "by …" and "1 earlier value(s) kept" | P |
| 8.7 | Try saving a rate for a closed/locked month | 409 "…its exchange rates are locked" | P |

## 9. Bank reconciliation

| # | Step | Expected | Class |
|---|---|---|---|
| 9.1 | Workforce → Reconciliation Agent → Ask | Parent: **1,015** lines, **1,012** matched, 5 exceptions (SWIFT −450, profit credit +1,250, deposit +8,750, Meridian −68,000, utilities duplicate −6,014) | A |
| 9.2 | Bank Reconciliation Report | Accounts table: unexplained difference **0.00**; reconciling items list 5 rows | R |
| 9.3 | Group close bank KPI | **1,028 / 1,025 / 5** (subsidiaries reconcile fully) | R |
| 9.4 | Agent card duration | Bank agent completes in seconds (indexed matching) | R |

## 10. Supplier invoices (AP) and volume

| # | Step | Expected | Class |
|---|---|---|---|
| 10.1 | Workforce → AP Agent → Ask (parent) | **257** invoices, **250** three-way matched, **7** exceptions | A |
| 10.2 | AP Processing Report | Duplicate "GIT 4471"; possible duplicate DW-7714; vendor mismatch Gulf Tech Trading; no PO Prime Events; awaiting GRN GIT-4480; GRNI HVAC 50,000 | R |
| 10.3 | Payment proposals | No held invoice listed; Sep overdue invoice included with reason "Overdue" | R |
| 10.4 | Group close AP KPI | **317** invoices, **7** exceptions | R |
| 10.5 | AP InvoiceFlow (`/ap-invoices`) on the demo parent | Demo invoices visible if the user is an AP company member (otherwise note: close agent reads via service role) | R |

## 11. Isolation and permissions (spot checks)

| # | Step | Expected | Class |
|---|---|---|---|
| 11.1 | As a **viewer** in the workspace: open Month-End Close | Can view; Run/Approve/Controls actions fail with 403 messages | R |
| 11.2 | Switch to a real company | No demo runs, journals or holdings appear | R |

---

## Sign-off

| Area | Status | Evidence | Notes |
|---|---|---|---|
| 0 Setup / global | | | |
| 1 Investment | | | |
| 2 FP&A rolling | | | |
| 3 Group close / CFO | | | |
| 4 Segregation | | | |
| 5 Limits | | | |
| 6 Accrual reversals | | | |
| 7 IFRS 9 rates | | | |
| 8 IAS 21 | | | |
| 9 Bank recon | | | |
| 10 AP volume | | | |
| 11 Isolation | | | |
