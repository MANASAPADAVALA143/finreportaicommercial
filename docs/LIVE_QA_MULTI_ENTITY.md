# Authenticated live QA — Multi-Entity / Group CFO foundation

**Architecture decision:** Option A — one workspace = one group = multiple companies.  
**Gate:** Group CFO Command Center (`/group-cfo`) must not start until this QA passes.  
**Production:** frontend https://finreportaicommercial.vercel.app · API https://finreportaicommercial.onrender.com (also https://api.finreportai.com)  
**Deploy verified:** backend commit `118500b` Live on Render (2026-11-13). New routes `/api/ai-close/fx-rates/settings` and `/forecast-settings` return 401 (auth required), not 404.

Expected figures: **full-volume synthetic demo group**, October 2026, after **Load the synthetic demo group** and one group close.

**Classes:** R = read-only · A = approved synthetic mutation · P = needs explicit approval on the day.

---

## Results summary (as of 2026-11-16)

| Bucket | Status |
|---|---|
| Automated tests (group close, consolidation, FX, isolation) | **PASS** (code verified) |
| Deploy / health / new API routes | **PASS** |
| Login page accessibility (Show password) | **PASS** (browser) |
| Authenticated browser: isolation, company selector, consolidation page, group close KPIs | **BLOCKED** — needs your login in Cursor’s browser (or screenshots from your session) |
| Mutations (journal approve, controls, FX, ECL) | **BLOCKED** — need P approval after login |

---

## A. Pre-flight (no login)

| # | Step | Expected | Result |
|---|---|---|---|
| A.1 | `GET /health` on Render and api.finreportai.com | 200, `db_ok: true` | **PASS** |
| A.2 | `GET /api/ai-close/fx-rates/settings` unauthenticated | 401 (route exists) | **PASS** |
| A.3 | `GET /api/ai-close/forecast-settings` unauthenticated | 401 | **PASS** |
| A.4 | CORS preflight from Vercel origin | 200 + `Access-Control-Allow-Origin` | **PASS** (when API healthy; fails during Render restart) |
| A.5 | Vercel bundle contains Group-related UI strings / seasonality / treasury admin | Present in Executive Summary chunk | **PASS** |

---

## B. Workspace isolation and company selection (login required)

| # | Step | Expected | Class | Result |
|---|---|---|---|---|
| B.1 | Log in as Owner; note active workspace | Header shows workspace; API calls send `X-Workspace-ID` | R | **BLOCKED** |
| B.2 | Company selector lists companies for this workspace only | Demo group: parent + 2 subsidiaries after seed; no other-client companies | R | **BLOCKED** |
| B.3 | Switch company → Month-End Close / Consolidation | Data and company banner change; no leftover KPIs from previous company | R | **BLOCKED** |
| B.4 | As Viewer: open Month-End Close | Can view; Run / Approve / Controls → 403 | R | **BLOCKED** |
| B.5 | Switch to a real non-demo company (e.g. garpsystems) | No demo runs, demo journals or demo holdings | R | **BLOCKED** |
| B.6 | Attempt group close with entity from another workspace (API) | Rejected; no cross-tenant aggregation | R | Code **PASS** (`test_group_start_validation` / audit isolation); live **BLOCKED** |

---

## C. Consolidation module (`/consolidation`)

| # | Step | Expected | Class | Result |
|---|---|---|---|---|
| C.1 | Open Consolidation; select period **2026-10** | Page loads; companies = all active profiles in workspace | R | **BLOCKED** |
| C.2 | Summary cards | Group cash / totals reconcile to underlying companies; missing data not silently zero without note | R | **BLOCKED** |
| C.3 | Consolidated P&L | Aggregate and eliminations columns; revenue ties to entity sum ± eliminations | R | **BLOCKED** |
| C.4 | Consolidated Balance Sheet | Assets ≈ liabilities + equity (within rounding) | R | **BLOCKED** |
| C.5 | Company comparison | One row per entity; drill-down to company dashboard works | R | **BLOCKED** |
| C.6 | Eliminations list | Manual eliminations visible; IC tags respected where used | R | **BLOCKED** |
| C.7 | Export PDF/Excel if offered | Opens; period and company names correct | R | **BLOCKED** |

**Code verified (not live):** AI Close consolidation eliminates IC- references and flags mismatches (`test_consolidation_eliminates_intercompany_and_flags_mismatch`). IAS 21 translation + historical equity + translation reserve (`test_ai_close_fx.py`).

---

## D. AI Group Close / CFO Executive Summary (`/ai-cfo/executive-summary`)

| # | Step | Expected | Class | Result |
|---|---|---|---|---|
| D.1 | Load synthetic demo group | Banner: *Gnanova Demo Trading LLC (synthetic data)*; 3 entities | A | **BLOCKED** (demo session interrupted by API restart earlier) |
| D.2 | Scope = Consolidated group; 2 subsidiaries ticked; Run Month-End Close | Status → awaiting approval ~30–90 s | A | **BLOCKED** |
| D.3 | KPI cards | Bank 1,028 / 1,025 / 5 · AP 317 / 7 · AR overdue 4 · IFRS 22 · Exceptions 28 · Pending 13 · Agents 9 | R | **BLOCKED** |
| D.4 | CFO Executive Summary | Revenue 856,598; consolidated 832,598; IC eliminated 24,000; Investments risk present | R | Code **PASS**; live **BLOCKED** |
| D.5 | Consolidation task / Close Pack | Group PL/BS + IC eliminations; translation section if FX company present | R | **BLOCKED** |
| D.6 | Refresh (F5) | Same run and figures | R | **BLOCKED** |
| D.7 | Group totals in reporting currency (AED-only demo) | No mixed-currency distortion; limitations empty of FX notes | R | Code **PASS**; live **BLOCKED** |

---

## E. Supporting checks (same session)

| # | Step | Expected | Class | Result |
|---|---|---|---|---|
| E.1 | Entity Health (`/cfo/entity-health` or nav) | Per-company readiness; group readiness | R | **BLOCKED** |
| E.2 | AI Finance Workforce → Ask Investment Agent | Portfolio 1,270,500; ENBD 33.1% | A | **BLOCKED** |
| E.3 | FP&A rolling 12 months | 2026-11→2027-10; best > base > worst | A/R | **BLOCKED** |
| E.4 | Landing `/dashboard` agent pills (R2R / IFRS / FP&A / CFO Decision / CFO Voice) | Labels readable (high-contrast text on dark pills) | R | **FIXED in code** (pending deploy + visual confirm) |
| E.5 | Login “Create a free account” | Visible solid button with dark text on light background | R | **FIXED in code** (pending deploy + visual confirm) |
| E.6 | API restart under load | Health returns after ~30–60 s; refresh recovers CORS errors | R | **PASS** (observed); monitor OOM on 512 MB |

---

## F. Sign-off gate for Phase B

Phase B (Group CFO Command Center) may start only when:

- [ ] B.1–B.5 PASS (or waived with written risk)
- [ ] C.1–C.6 PASS on demo period
- [ ] D.1–D.6 PASS with expected KPI figures (± rounding)
- [ ] No open P0 isolation defects
- [ ] Known UI defects E.4–E.5 logged for fix (non-blocking for Phase B start)

**Signed off by:** _______________ **Date:** _______________

---

## How to finish live QA (next session)

1. Open Cursor browser → https://finreportaicommercial.vercel.app/login → sign in as Owner (do not paste password in chat).
2. Say “logged in”.
3. Agent runs sections B → C → D in order; captures screenshots; marks PASS/FAIL.
4. Avoid double-loading the demo group; if API dies, wait 60 s and F5.
5. P-class rows only after your explicit approval.
