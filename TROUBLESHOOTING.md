# 🔧 TROUBLESHOOTING - Backend Hanging Issue

## ⚠️ CURRENT PROBLEM

The backend keeps **hanging during startup** when using uvicorn's reload mode. The worker process never completes initialization.

---

## 🎯 SOLUTION: Manual Start (RECOMMENDED)

### Step 1: Open PowerShell Manually
1. Press `Win + X`
2. Select "Windows PowerShell" or "Terminal"

### Step 2: Navigate to Backend
```powershell
cd C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend
```

### Step 3: Start Backend (WITHOUT reload)
```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### Step 4: Wait for This Message
```
INFO:     Started server process [XXXXX]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### Step 5: Test It
Open another PowerShell and run:
```powershell
Invoke-RestMethod -Uri "http://localhost:8000/health"
```

Expected output:
```json
{"status": "healthy"}
```

---

## 🚀 THEN TEST THE UPLOAD

1. Go to: **http://localhost:3000**
2. Navigate to: **R2R Module**
3. Upload: `backend\sample_journal_entries_LABELED.csv`
4. Click: **Analyze with Nova AI**

---

## 🔍 WHY IS IT HANGING?

### Root Cause:
Uvicorn's **reload mode** (`--reload`) uses a file watcher that sometimes hangs on Windows when:
- AWS SDK is being imported
- Large dependencies are loaded
- File system watchers conflict

### The Fix:
**Don't use `--reload` mode** - start without it:
```powershell
# ❌ This hangs:
python -m uvicorn app.main:app --reload

# ✅ This works:
python -m uvicorn app.main:app
```

---

## 📋 ALTERNATIVE: Use the Script

Double-click this file:
```
C:\Users\HCSUSER\OneDrive\Desktop\CFO\START_BACKEND.ps1
```

It will open a PowerShell window and start the backend.

---

## 🔧 IF PORT 8000 IS BLOCKED

If you get "address already in use" error:

### Option 1: Kill the process
```powershell
Get-Process -Name python | Stop-Process -Force
```

### Option 2: Use a different port
```powershell
python -m uvicorn app.main:app --port 8001
```

Then update frontend to use port 8001:
- Edit: `frontend\src\components\r2r\R2RModule.tsx`
- Change: `http://localhost:8000` → `http://localhost:8001`

---

## ✅ VERIFICATION CHECKLIST

Before uploading, verify:

1. **Backend Running?**
   ```powershell
   Invoke-RestMethod -Uri "http://localhost:8000/health"
   ```
   Should return: `{"status": "healthy"}`

2. **Frontend Running?**
   Open: http://localhost:3000
   Should show: CFO Dashboard

3. **Logged In?**
   - If not, click "Register" → Create account → Login

4. **File Ready?**
   Check file exists:
   ```powershell
   Test-Path "C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend\sample_journal_entries_LABELED.csv"
   ```
   Should return: `True`

---

## 🎯 EXPECTED BEHAVIOR

### When Backend Starts Successfully:
```
INFO:     Started server process [12345]
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### When You Upload a File:
```
INFO:     127.0.0.1:xxxxx - "POST /journal-entries/upload HTTP/1.1" 200 OK
```

### In Frontend:
- Loading spinner appears
- After 5-10 seconds: Results table shows
- Ground truth metrics displayed
- Confusion matrix visible

---

## 🐛 COMMON ERRORS & FIXES

### Error: "404 Not Found"
**Cause**: Wrong backend running or backend crashed
**Fix**: Restart backend manually (see Step 1-4 above)

### Error: "401 Unauthorized"
**Cause**: Not logged in
**Fix**: Go to http://localhost:3000 → Login

### Error: "Connection refused"
**Cause**: Backend not running
**Fix**: Start backend manually

### Error: "Port 8000 already in use"
**Cause**: Another process using port 8000
**Fix**: 
```powershell
Get-Process -Name python | Stop-Process -Force
# Wait 3 seconds, then restart
```

---

## 📊 WHAT YOU SHOULD SEE AFTER UPLOAD

### Summary:
```
Total Entries: 10
High Risk: 2-3
Medium Risk: 4-5
Low Risk: 3
```

### Ground Truth:
```
True Anomalies: 7
Detected: 6-7 (85-100%)
Missed: 0-1
False Alarms: 0-1
```

### Metrics:
```
Accuracy: 90-100%
Precision: 85-100%
Recall: 85-100%
F1 Score: 85-95%
```

---

## 💡 PRO TIP

Keep the backend PowerShell window open and visible. You'll see:
- Each API request logged
- Any errors in real-time
- Performance metrics

---

## 🆘 STILL NOT WORKING?

1. **Check Python version**:
   ```powershell
   python --version
   ```
   Should be: Python 3.8 or higher

2. **Check dependencies**:
   ```powershell
   cd C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend
   pip install -r requirements.txt
   ```

3. **Test import**:
   ```powershell
   cd C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend
   python -c "from app.main import app; print('OK')"
   ```
   Should print: `OK`

4. **Check AWS credentials** (optional - fallback works without):
   ```powershell
   cd C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend
   Get-Content .env | Select-String "AWS"
   ```

---

## 📞 QUICK REFERENCE

| What | Command |
|------|---------|
| Start Backend | `cd backend; python -m uvicorn app.main:app --port 8000` |
| Test Backend | `Invoke-RestMethod http://localhost:8000/health` |
| Stop Backend | `Ctrl+C` in the PowerShell window |
| Start Frontend | `cd frontend; npm run dev` |
| Kill All Python | `Get-Process -Name python \| Stop-Process -Force` |

---

**Remember**: Start backend **WITHOUT** `--reload` flag!
