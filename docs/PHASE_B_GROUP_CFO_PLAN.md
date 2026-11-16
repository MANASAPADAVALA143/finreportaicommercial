# Phase B — Group CFO Command Center (implementation plan)

**Status:** Architecture APPROVED (2026-11-16). Implementation **blocked** until authenticated live QA (see `docs/LIVE_QA_MULTI_ENTITY.md`) sections B–D pass and explicit “start coding” approval is given.

**Approved decisions:** workspace = group; `/group-cfo`; no Organization tables; thin `GET /api/group-cfo/overview` (no second consolidation maths; workspace isolation; period/currency/freshness/missing-data); reuse consolidation + AI Group Close + entity health; Decision Queue v1 = existing approvals; new decision table deferred to v2.  
**Architecture:** Option A — one workspace = one group = multiple companies.  
**Product name:** Group CFO Command Center  
**Route:** `/group-cfo`  
**Positioning:** Primary commercial demo for Gnanova Multi-Entity CFO.

---

## 1. Goals

A CEO / Group CFO logs into a workspace, sees every legal entity, understands the group’s financial position, spots risks, and asks AI what needs attention — without leaving the app.

Six sections (product requirement):

1. Group Executive Overview  
2. Portfolio & Company Performance  
3. Consolidated Financial Intelligence  
4. Group Cash & Debt Intelligence  
5. Risk & CEO Decision Queue  
6. AI Group CFO Assistant  

---

## 2. Non-negotiables

| Do | Do not |
|---|---|
| Reuse `consolidation_service.py` | Build a second consolidation engine |
| Reuse AI Close group run + `cfo_agent` | Fabricate numbers in AI text |
| Keep `workspace_id` as tenant key | Add `organizations` / `organization_workspaces` tables |
| Compose ledger-backed APIs | Use legacy `/cfo-dashboard` mock data |
| Label missing data explicitly | Treat missing as silent zero |
| Drill into existing company dashboards | Duplicate company records |

---

## 3. Data sources (reuse map)

| Section | Primary APIs / services | Notes |
|---|---|---|
| Executive KPIs | `GET /api/consolidation/summary`, `/pl`, `/bs` | Period picker; reporting currency from workspace / parent company |
| Company performance | `GET /api/consolidation/comparison` + `GET /api/company-setup/companies` | Contribution % computed client- or thin-API-side |
| Eliminations / IC | `GET /api/consolidation/eliminations` + latest AI Close consolidation task | Distinguish manual eliminations vs AI IC- matches |
| Entity health / risks | Entity health routes + open AI Close exceptions | Priority from severity + amount |
| Cash | BS `cash_bank` by entity + bank recon unmatched from latest close | No inventing cash |
| Debt | BS `long_term_borrowings` + finance costs; IFRS 16 lease liability where present | Label “ledger / lease-based; no dedicated loan register yet” |
| AI assistant | AI Close ask (`scope=group`) + existing AI CFO ask patterns | Facts only; unverified numbers discarded |
| Decision queue | New thin store **or** map to existing AI CFO approvals + close journal proposals | Prefer reuse first; new table only if approve/reject/assign needs group-level audit |

---

## 4. UI structure

**Page:** `frontend/src/pages/group-cfo/GroupCfoCommandCenter.tsx`  
**Nav:** Executive Hub → “Group CFO Command Center” → `/group-cfo` (`suiteNavigation.ts`)  
**Chrome:** Workspace already selected; period control (month); currency badge; “Last refreshed”; link to Month-End Close and Consolidation.

### Section 1 — Group Executive Overview

KPI cards (from consolidation summary / derived PL·BS):

- Total Assets, Total Net Worth, Consolidated Revenue, Consolidated Net Profit  
- Secondary: Total Cash, Total Debt, EBITDA (if mappable), Operating Cash Flow (label if unavailable), Receivables, Payables  

Each card: current, prior period Δ / %, currency, as-of date.  
Missing prior period → show “—” not 0.

### Section 2 — Portfolio & Company Performance

- Industry cards from `UaeCompanyProfile.industry` (group entities with zero companies omitted)  
- Revenue-by-entity horizontal bars + contribution %  
- Comparison table: Revenue, Net Profit, Cash, Assets, Debt, Net Worth, AR; search/sort; click → existing company route  
- Export: Excel via openpyxl pattern used elsewhere, or client CSV v1  

### Section 3 — Consolidated Financial Intelligence

- Embedded or linked views of consolidated PL and BS (reuse consolidation page components / service)  
- Eliminations summary strip + link to full Consolidation page  
- Status: “Preliminary aggregation” vs “Close pack available” if a group AI Close run exists for the period  

### Section 4 — Group Cash & Debt Intelligence

- Cash by company (bar) + consolidated total  
- Debt by company from mapped borrowings (+ leases called out)  
- Maturity / repayment: only where IFRS 16 or investment maturities exist; otherwise explicit gap note  
- 12-month cash outlook: from latest group FP&A rolling forecast if a group close/ask exists; else CTA to run FP&A / close  

### Section 5 — Risk & CEO Decision Queue

**Needs attention** (deterministic, no LLM):

- Open high/medium AI Close exceptions (group latest run)  
- Entity health failures  
- Concentration / liquidity risks from CFO summary if present  
- Low cash / negative profit from comparison  

Columns: priority, company, issue, date, amount, recommended action.

**Decision queue (v1):** surface pending journal proposals + AI CFO approval requests for the workspace/group; actions call existing decide/approve APIs.  
**v2 (only if needed):** `group_cfo_decisions` table with assign/comment/complete + audit log.

### Section 6 — AI Group CFO Assistant

- Chat / prompt panel scoped to workspace + selected period + entity set = all active companies (or user subset)  
- Reuse ask/agent stack; system prompt: group CFO; numbers must appear in tool/facts JSON  
- Suggested prompts: profitability change, highest debt, liquidity, IC mismatches, board summary  

---

## 5. Backend work (minimal)

Prefer **one aggregator** endpoint to cut waterfall calls:

`GET /api/group-cfo/overview?period=YYYY-MM`

Returns: `{ currency, period, kpis, by_company[], industries[], cash[], debt[], risks[], close_run_id?, limitations[] }`  
Internally calls consolidation_service + company list + optional latest AiCloseRun (group) + entity health.  
Auth: existing workspace membership + read on each company included (same rule as group close read).

Optional later:

- `GET /api/group-cfo/export.xlsx`  
- Decision APIs only if v2 store is approved  

**Migrations:** none for Option A unless Decision Queue v2 is approved.

---

## 6. Design

- Follow existing Gnanova / suite patterns (navy, gold accents already used on AI CFO pages)  
- Reference screenshots = layout density and section order, not a new design system  
- Recharts for donut / bars / combo charts  
- Responsive: KPI grid collapses; tables scroll horizontally  
- No purple-on-white generic AI aesthetic; no fake “glow” cards  

---

## 7. Demo data

- Default: existing **synthetic demo group** (3 entities) via Load demo  
- Optional later: expand demo to six companies **only if** commercial demo requires it; keep clearly tagged synthetic  
- Never seed into real client workspaces without explicit action  

---

## 8. Implementation slices (after QA sign-off)

| Slice | Deliverable | Exit criteria |
|---|---|---|
| B0 | Plan approved + QA gate open | This doc + LIVE_QA_MULTI_ENTITY sign-off |
| B1 | Route, nav, overview aggregator API, KPI cards | KPIs match `/api/consolidation/*` for same period |
| B2 | Company table + industry cards + drill-down | Totals = sum of rows; no double count |
| B3 | Embed/link consolidated PL·BS·eliminations | Existing consolidation tests still green |
| B4 | Cash & debt panels + limitations copy | Missing loan register labelled |
| B5 | Risks from exceptions + entity health | Deterministic; screenshotable |
| B6 | AI Group CFO panel | Unverified numbers discarded; group scope only |
| B7 | Decision queue v1 (existing approvals) | Approve/reject hits existing APIs |
| B8 | Tests + live QA checklist rows for `/group-cfo` | Frontend tsc baseline held; backend tests added |

After each slice: relevant pytest, `npx tsc --noEmit`, smoke on demo workspace.

---

## 9. Test plan (Phase B)

**Backend**

- Overview KPIs == consolidation summary for fixture workspace  
- Cross-workspace company id rejected  
- Empty company list → empty KPIs + limitation, not zeros pretending to be data  
- Viewer can read; writer not required for overview  

**Frontend**

- Period change refetches  
- Click company opens existing dashboard  
- AI panel does not show when facts empty  

**Regression**

- Consolidation page, AI group close, company setup unchanged  

---

## 10. Explicitly deferred

- Organization tenant / multi-workspace holdings  
- Ownership % / NCI  
- Full loan register / insurance expiry engine  
- Auto-learned seasonality  
- Rebuilding AI CFO Command Centre or Month-End Close  

---

## 11. Approval

| Item | Decision |
|---|---|
| Option A (workspace = group) | Approved |
| Start coding before live QA sign-off | **No** |
| Aggregator API `/api/group-cfo/overview` | Proposed — approve/reject in review |
| Decision Queue v1 vs v2 | Default v1; approve v2 only if needed |
| Six-company demo expansion | Optional; not required for B1–B7 |

**Plan approved by:** _______________ **Date:** _______________
