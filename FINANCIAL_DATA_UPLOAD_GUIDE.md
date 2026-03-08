# 📊 CFO Dashboard - Financial Data Upload Guide

## ✅ **YOU CAN NOW UPLOAD 2 TYPES OF FILES:**

---

## 📋 **OPTION 1: TRIAL BALANCE** (RECOMMENDED - NOW WORKING!)

### **✅ Current Status:**
```
Cash: $812,450
Revenue: $447,000
Expenses: $305,000
Health Score: 66/100
```

### **What is Trial Balance?**
A Trial Balance shows the **ending balances** of all your accounts at a point in time. This is the **BEST** format for CFO dashboard because:
- ✅ Shows current financial position instantly
- ✅ No calculations needed - direct balances
- ✅ Standard accounting report
- ✅ What CFOs actually use

---

### **Format Required:**

**CSV or Excel with these columns:**

```csv
Account Code,Account Name,Account Type,Debit,Credit
1000,Cash,Asset,812450,0
1100,Accounts Receivable,Asset,420000,0
1200,Inventory,Asset,95000,0
2000,Accounts Payable,Liability,0,310000
2100,Short-Term Debt,Liability,0,250000
3000,Equity,Equity,0,1200000
4000,Revenue - Product,Revenue,0,362000
4100,Revenue - Services,Revenue,0,85000
5000,Marketing,Expense,94000,0
5100,Operations,Expense,118000,0
5200,Engineering,Expense,64000,0
5300,G&A Expenses,Expense,29000,0
```

### **Column Requirements:**

1. **Account Code** (optional but recommended)
   - Any numbering system (1000, 2000, etc.)

2. **Account Name** (REQUIRED)
   - Cash, Revenue, Expenses, etc.

3. **Account Type** (REQUIRED)
   - Must be one of: `Asset`, `Liability`, `Equity`, `Revenue`, `Expense`

4. **Debit** (REQUIRED)
   - Amount in debit column (use 0 if none)

5. **Credit** (REQUIRED)
   - Amount in credit column (use 0 if none)

---

### **How to Upload Your Trial Balance:**

#### **Method 1: Replace the File Directly**
```bash
# Save your Trial Balance as:
backend/trial_balance.csv

# Then refresh browser
```

#### **Method 2: Upload via API**
```bash
curl -X POST "http://localhost:8000/api/cfo/upload/trial-balance" \
  -F "file=@your_trial_balance.xlsx"
```

#### **Method 3: Upload via Python**
```python
import requests

files = {'file': open('my_trial_balance.xlsx', 'rb')}
response = requests.post(
    'http://localhost:8000/api/cfo/upload/trial-balance',
    files=files
)

print(response.json())
```

---

### **What Gets Calculated:**

From your Trial Balance, the dashboard automatically calculates:

✅ **Cash Position**
- Total cash from all Asset accounts containing "Cash"
- Cash: $812,450 (from 1000-Cash account)

✅ **Revenue**
- Total from all Revenue accounts
- Revenue: $447,000 (from 4000 + 4100)

✅ **Expenses**
- Total from all Expense accounts by category
- Total: $305,000
- Breakdown:
  - Operations: $118,000
  - Marketing: $94,000
  - Engineering: $64,000
  - G&A: $29,000

✅ **Financial Ratios**
- Current Ratio
- Quick Ratio
- Debt-to-Equity
- ROE
- Operating Margin

✅ **Health Score**
- Overall: 66/100
- Liquidity, Profitability, Efficiency, Stability scores

---

## 📝 **OPTION 2: JOURNAL ENTRIES**

### **What are Journal Entries?**
Detailed transactions showing debits and credits for each transaction.

### **Format:**
```csv
id,date,account,description,debit,credit,preparer,approver
JE001,2026-02-14,1000-Cash,Payment received,10000,0,John,Mary
JE002,2026-02-14,5000-Revenue,Sales,0,10000,Sarah,Mike
JE003,2026-02-14,6000-Expense,Rent,2000,0,Emily,Mary
```

### **Upload:**
```bash
curl -X POST "http://localhost:8000/api/cfo/upload/journal-entries" \
  -F "file=@journal_entries.csv"
```

---

## 🎯 **WHICH ONE SHOULD YOU USE?**

| Feature | Trial Balance | Journal Entries |
|---------|---------------|-----------------|
| **Best for** | CFO Dashboard | Detailed audit trail |
| **Complexity** | ⭐ Simple | ⭐⭐⭐ Complex |
| **What it shows** | Current balances | Transaction history |
| **When to use** | Monthly reports | Daily accounting |
| **Data size** | Small (~10-100 rows) | Large (1000s of rows) |
| **Recommended** | ✅ YES | For detailed analysis |

**→ For CFO Dashboard: Use Trial Balance!**

---

## 📤 **HOW TO GET YOUR TRIAL BALANCE:**

### **From QuickBooks:**
1. Go to `Reports` → `Accountant & Taxes`
2. Click `Trial Balance`
3. Select date range
4. Export to Excel
5. Upload to CFO Dashboard

### **From Xero:**
1. Go to `Accounting` → `Reports`
2. Click `Trial Balance`
3. Export to Excel
4. Upload to CFO Dashboard

### **From SAP:**
1. Transaction Code: `FS10N` or `FBL3N`
2. Export trial balance report
3. Upload to CFO Dashboard

### **From Excel:**
Just create a spreadsheet with the 5 columns (Account Code, Account Name, Account Type, Debit, Credit)

---

## 🔄 **DATA FLOW:**

```
┌─────────────────────────────────┐
│   YOUR ACCOUNTING SYSTEM        │
│  (QuickBooks / Xero / Excel)    │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│   Export Trial Balance          │
│   • Excel (.xlsx)               │
│   • CSV (.csv)                  │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│   Upload to CFO Dashboard       │
│   API: /api/cfo/upload/trial-   │
│        balance                  │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│   Parser Extracts:              │
│   • Cash from Assets            │
│   • Revenue totals              │
│   • Expenses by category        │
│   • Calculate ratios            │
└───────────────┬─────────────────┘
                │
                ▼
┌─────────────────────────────────┐
│   CFO Dashboard Updates         │
│   • KPI cards                   │
│   • Charts                      │
│   • Health score                │
│   • Recommendations             │
└─────────────────────────────────┘
```

---

## ✅ **CURRENT STATUS:**

Your dashboard is configured to check files in this order:

1. **trial_balance.csv** (PRIORITY 1) ✅ WORKING
2. **sample_journal_entries.csv** (PRIORITY 2) ✅ WORKING
3. **Mock data** (FALLBACK) ✅ WORKING

---

## 📋 **QUICK START:**

### **To see YOUR data now:**

**Step 1:** Open Excel and create your Trial Balance:
```
Account Code | Account Name | Account Type | Debit | Credit
1000         | Cash         | Asset        | 50000 | 0
4000         | Revenue      | Revenue      | 0     | 75000
5000         | Expenses     | Expense      | 25000 | 0
```

**Step 2:** Save as CSV:
```
C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend\trial_balance.csv
```

**Step 3:** Refresh browser (Ctrl+Shift+R)

**Step 4:** See your data! 🎉

---

## 🎯 **NEXT LEVEL: AUTOMATED SYNC**

### **Phase 1 (Current): Manual Upload** ✅
- User uploads Trial Balance monthly
- Dashboard updates immediately

### **Phase 2 (Next): Scheduled Sync** 🎯
- Connect QuickBooks/Xero OAuth
- Auto-sync daily
- Email alerts when insights change

### **Phase 3 (Future): Real-time Integration** 🚀
- Live connection to accounting system
- Updates every hour
- Instant alerts on anomalies

---

## 💡 **PRO TIPS:**

1. **Monthly Cadence:**
   - Upload Trial Balance at month-end
   - Compare to previous months
   - Track trends

2. **Categorization:**
   - Use consistent account names
   - Group similar expenses together
   - Makes charts more meaningful

3. **Data Quality:**
   - Reconcile accounts before exporting
   - Check debits = credits
   - Verify account types are correct

4. **Automation:**
   - Set calendar reminder to upload monthly
   - Or connect QuickBooks/Xero for auto-sync
   - No manual work needed!

---

## ❓ **TROUBLESHOOTING:**

**Dashboard shows $0:**
- Check Trial Balance file exists in `backend/trial_balance.csv`
- Verify account types are spelled correctly (Asset, Liability, Revenue, Expense)
- Refresh browser (Ctrl+Shift+R)

**Upload fails:**
- Check column names match exactly
- Verify file is CSV or Excel format
- Check for special characters in account names

**Wrong amounts:**
- Check debit/credit columns
- For Assets/Expenses: Amount goes in Debit
- For Liabilities/Equity/Revenue: Amount goes in Credit

---

## 📞 **API ENDPOINTS:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/cfo/dashboard` | GET | Get dashboard data (auto-detects source) |
| `/api/cfo/upload/trial-balance` | POST | Upload Trial Balance |
| `/api/cfo/upload/journal-entries` | POST | Upload Journal Entries |
| `/api/cfo/data-sources` | GET | Check which files are loaded |
| `/api/cfo/export` | POST | Export dashboard (Excel/CSV/PDF) |

---

## ✅ **YOUR DATA IS READY!**

```
✅ Trial Balance Parser: WORKING
✅ Your Data Loaded: $812,450 cash, $447,000 revenue
✅ Dashboard Ready: Refresh to see it!
```

**Refresh your browser now to see YOUR financial data!** 🚀

---

## 📖 **WANT TO BUILD THE BEST CFO PRODUCT?**

### **Recommended Roadmap:**

**Month 1 (MVP):**
- ✅ Manual Trial Balance upload (DONE!)
- ✅ CFO Dashboard visualization (DONE!)
- ✅ Export functionality (DONE!)

**Month 2 (Production):**
- 🎯 QuickBooks OAuth integration
- 🎯 Auto-sync every 6 hours
- 🎯 Email alerts

**Month 3 (Scale):**
- 🚀 Xero integration
- 🚀 Multi-entity support
- 🚀 AI-powered recommendations

**That's the path to a $10M+ ARR product!** 💰
