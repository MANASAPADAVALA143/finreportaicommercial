# FinReportAI — Excel Office Add-in (install)

This add-in talks to your existing FastAPI FP&A endpoints (`/api/fpa/*`, `/api/reports/board-pack`, `/api/chat/ask`). No VBA, no macros.

## Local development (recommended first)

1. **Start backend** on port 8000 (e.g. `uvicorn app.main:app --reload --port 8000` from `backend/`).
2. **Start frontend** on port 3006 (`npm run dev` from `frontend/`). Vite serves the add-in at  
   `http://localhost:3006/addin/taskpane.html` (files live in `frontend/public/addin/`).
3. **Save `excel-addin/manifest.xml`** to your Desktop (or any folder). It is preconfigured for **http://localhost:3006** taskpane and commands URLs.
4. Open **Excel** (desktop or **Excel on the web**).
5. **Insert → Add-ins → Upload My Add-in** (wording may vary; on the web use **Upload** under Office Add-ins).
6. Choose **`manifest.xml`** and confirm.
7. On the **Home** tab, open the **FinReportAI** group and click **FinReportAI** to show the task pane.

### Settings in the task pane

- Leave **API base URL** empty while testing on `localhost:3006` so requests use the same origin and Vite’s **`/api` proxy** to `http://localhost:8000`.
- For a hosted web app (no proxy), set API base to your public API origin, e.g. `https://finreportai.railway.app` (no trailing slash).

## Production / Railway

1. Deploy the **frontend** so `https://<your-host>/addin/taskpane.html` (and `commands.html`, `assets/*`) are publicly reachable over **HTTPS**.
2. Copy `excel-addin/manifest.xml` to a new file (e.g. `manifest.production.xml`) and replace every  
   `http://localhost:3006` with your real **https://…** origin.
3. Sideload or centrally deploy that manifest per your Microsoft 365 admin process.

## Security notes

- The add-in uses **ReadWriteDocument** to append a **FinReportAI** results block under the used range.
- Chat sends a **snippet of the sheet** (first ~30 rows) to `/api/chat/ask` — avoid confidential data in those rows or tighten the range in `taskpane.js` later.

## Files

| Path | Role |
|------|------|
| `excel-addin/manifest.xml` | Office manifest (sideload this) |
| `excel-addin/src/*` | Source copies of task pane + commands |
| `frontend/public/addin/*` | What Vite actually serves at `/addin/` |

Keep `excel-addin/src` and `frontend/public/addin` in sync when you edit the add-in (or automate copy in CI).
