# 📊 CFO Dashboard - How to Input Your Data

## ✅ **OPTION 1: Journal Entries CSV** (EASIEST - NOW ACTIVE!)

### **Current Status: ✅ WORKING**
```
Cash: $562,000
Revenue: $503,000  
Expenses: $151,200
```

### **How to Update with YOUR Data:**

**Step 1:** Edit the CSV file:
```
backend/sample_journal_entries.csv
```

**Step 2:** Use this format:
```csv
id,date,account,description,debit,credit,preparer,approver
JE001,2026-02-14,1000-Cash,Cash deposit,10000,0,John,Mary
JE002,2026-02-14,5000-Revenue,Sales,0,5000,Sarah,Mike
JE003,2026-02-14,6000-Expense,Rent,2000,0,Emily,Mary
```

**Step 3:** Account naming rules:
- **Cash accounts**: Must contain "Cash" (e.g., `1000-Cash`, `Bank-Cash`)
- **Revenue accounts**: Must contain "Revenue" (e.g., `5000-Revenue`, `Income-Revenue`)
- **Expense accounts**: Must contain "Expense" (e.g., `6000-Expense`, `7000-Marketing`)

**Step 4:** Date format:
- Use: `YYYY-MM-DD` (e.g., `2026-02-14`)
- **IMPORTANT**: Use dates from the last 30 days for "Month" view

**Step 5:** Refresh your browser!

---

## 📤 **OPTION 2: Upload Files via API**

### **2A: Upload Journal Entries**

**Using curl:**
```bash
curl -X POST "http://localhost:8000/api/cfo/upload/journal-entries" \
  -F "file=@my_journal_entries.csv"
```

**Using Python:**
```python
import requests

files = {'file': open('my_journal_entries.csv', 'rb')}
response = requests.post(
    'http://localhost:8000/api/cfo/upload/journal-entries',
    files=files
)
print(response.json())
```

---

### **2B: Upload Financial Summary (JSON)**

**Create file:** `financial_summary.json`

```json
{
  "date": "2026-02-14",
  "cash": {
    "total": 562000,
    "history_7_days": [520000, 535000, 548000, 562000, 575000, 580000, 562000]
  },
  "revenue": {
    "this_month": 328000,
    "annual_run_rate": 3936000,
    "history_6_months": [245000, 268000, 291000, 308000, 315000, 328000]
  },
  "expenses": {
    "this_month": 234000,
    "by_category": [
      {"name": "Operations", "value": 105000, "percentage": 45},
      {"name": "Marketing", "value": 58000, "percentage": 25},
      {"name": "Sales", "value": 47000, "percentage": 20},
      {"name": "R&D", "value": 24000, "percentage": 10}
    ]
  },
  "financial_ratios": {
    "current_ratio": 2.4,
    "quick_ratio": 1.8,
    "debt_to_equity": 0.3,
    "roe": 18,
    "operating_margin": 28.7
  }
}
```

**Upload:**
```bash
curl -X POST "http://localhost:8000/api/cfo/upload/financial-summary" \
  -F "file=@financial_summary.json"
```

---

### **2C: Upload Excel/CSV Summary**

**Create Excel file:** `financial_summary.xlsx`

**Columns:**
```
metric          | value    | date       | category
----------------|----------|------------|----------
cash_balance    | 562000   | 2026-02-14 | assets
revenue_monthly | 328000   | 2026-02-14 | income
expenses_monthly| 234000   | 2026-02-14 | expenses
```

**Upload:**
```bash
curl -X POST "http://localhost:8000/api/cfo/upload/financial-summary" \
  -F "file=@financial_summary.xlsx"
```

---

## 🔌 **OPTION 3: Connect Accounting Software**

### **QuickBooks Online**

**Step 1:** Get OAuth Token from QuickBooks Developer Portal

**Step 2:** Connect:
```bash
curl -X POST "http://localhost:8000/api/cfo/connect/accounting-software" \
  -d "platform=quickbooks" \
  -d "access_token=YOUR_TOKEN" \
  -d "company_id=YOUR_COMPANY_ID"
```

**Python:**
```python
import requests

response = requests.post(
    'http://localhost:8000/api/cfo/connect/accounting-software',
    params={
        'platform': 'quickbooks',
        'access_token': 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        'company_id': '1234567890'
    }
)

dashboard_data = response.json()['data']
print(f"Connected! Cash: ${dashboard_data['cash']['current']:,}")
```

---

### **Xero**

**Step 1:** Get OAuth Token from Xero Developer Portal

**Step 2:** Connect:
```bash
curl -X POST "http://localhost:8000/api/cfo/connect/accounting-software" \
  -d "platform=xero" \
  -d "access_token=YOUR_TOKEN" \
  -d "company_id=YOUR_TENANT_ID"
```

---

## 🔍 **Check Connected Data Sources**

```bash
curl http://localhost:8000/api/cfo/data-sources
```

**Response:**
```json
{
  "sources": [
    {
      "type": "journal_entries",
      "name": "Journal Entries CSV",
      "status": "connected",
      "file": "sample_journal_entries.csv",
      "last_updated": "2026-02-14T10:30:00"
    }
  ],
  "primary_source": "journal_entries"
}
```

---

## 📋 **Your Own Data - Step by Step**

### **Replace Sample Data with YOUR Company Data:**

1. **Open the CSV file:**
   ```
   backend/sample_journal_entries.csv
   ```

2. **Replace with your entries:**
   - Keep the same columns: `id,date,account,description,debit,credit,preparer,approver`
   - Use current dates (2026)
   - Name accounts with "Cash", "Revenue", or "Expense"

3. **Example for YOUR company:**
   ```csv
   id,date,account,description,debit,credit,preparer,approver
   JE001,2026-02-14,1000-Cash,Customer payment,50000,0,You,Manager
   JE002,2026-02-14,5000-Revenue,Sales invoice,0,50000,You,Manager
   JE003,2026-02-14,6000-Expense,Office rent,3000,0,You,Manager
   JE004,2026-02-14,7000-Marketing,Google Ads,1500,0,You,Manager
   ```

4. **Save the file**

5. **Refresh browser** (Ctrl+Shift+R)

6. **See YOUR data on the dashboard!** 🎉

---

## 🎯 **Quick Reference**

| Method | Difficulty | Best For |
|--------|-----------|----------|
| **Journal Entries CSV** | ⭐ Easy | Testing, small companies |
| **Upload Files** | ⭐⭐ Medium | One-time imports, custom data |
| **Accounting API** | ⭐⭐⭐ Advanced | Real-time sync, large companies |

---

## 💡 **Tips**

1. **For testing:** Use the current CSV (already working!)
2. **For production:** Connect QuickBooks or Xero
3. **For custom systems:** Upload JSON financial summaries
4. **Dates matter:** Use dates within your selected time range (Week/Month/Quarter/Year)

---

## ❓ **Common Issues**

**Dashboard shows $0:**
- Check dates are current (2026)
- Check account names contain "Cash", "Revenue", or "Expense"
- Refresh browser (Ctrl+Shift+R)

**Upload fails:**
- Check file format (CSV must have correct columns)
- Check file size (< 10MB)
- Check backend is running on port 8000

**Export doesn't work:**
- Refresh browser
- Check browser console (F12) for errors
- Make sure backend is running

---

## ✅ **Current Status**

```
✅ Journal Entries: WORKING
✅ File Upload API: READY
✅ Accounting Software API: READY
✅ Export (Excel/CSV/PDF): WORKING
```

**Next step:** Refresh your browser to see the data! 🚀
