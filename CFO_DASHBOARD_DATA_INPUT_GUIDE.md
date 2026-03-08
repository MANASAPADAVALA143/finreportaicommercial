# 📊 CFO Dashboard - Data Input Guide

Complete guide for connecting data sources to the CFO Strategic Dashboard

---

## 🎯 **3 WAYS TO INPUT DATA**

### **Option 1: Use Journal Entries (Recommended)** ⭐
### **Option 2: Upload Financial Summary Files**
### **Option 3: Connect Accounting Software API**

---

## 📁 **OPTION 1: Journal Entries (Automatic Calculation)**

### **How It Works:**
The dashboard automatically calculates metrics from your journal entries CSV file.

### **Input File:**
```
sample_journal_entries.csv
```

### **Required Columns:**
```csv
id,date,account,description,debit,credit,preparer,approver
JE001,2024-02-10,1000-Cash,Payment received,5000,0,John,Mary
JE002,2024-02-11,5000-Revenue,Product sales,0,125000,Sarah,Michael
JE003,2024-02-10,6000-Expense,Office supplies,2500,0,Emily,Mary
```

### **What Gets Calculated:**
- ✅ Cash Position (from Cash accounts)
- ✅ Revenue (from Revenue accounts)
- ✅ Expenses (from Expense accounts)
- ✅ Financial Health Score
- ✅ Runway (months)
- ✅ Trends & History

### **API Endpoint:**
```http
GET /api/cfo/dashboard?time_range=month
```

### **Backend Code:**
```python
# Automatically uses journal entries if file exists
calculator = CFOMetricsCalculator("sample_journal_entries.csv")
metrics = calculator.calculate_all_metrics(time_range="month")
```

---

## 📤 **OPTION 2: Upload Financial Summary**

### **2A: Upload Journal Entries**

**Endpoint:**
```http
POST /api/cfo/upload/journal-entries
Content-Type: multipart/form-data
```

**Example (curl):**
```bash
curl -X POST "http://localhost:8000/api/cfo/upload/journal-entries" \
  -F "file=@my_journal_entries.csv"
```

**Example (Python):**
```python
import requests

files = {'file': open('my_journal_entries.csv', 'rb')}
response = requests.post(
    'http://localhost:8000/api/cfo/upload/journal-entries',
    files=files
)
print(response.json())
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully processed my_journal_entries.csv",
  "data": {
    "healthScore": {...},
    "cash": {...},
    "revenue": {...},
    "expenses": {...}
  }
}
```

---

### **2B: Upload Financial Summary (JSON)**

**File Format:** `financial_summary.json`

```json
{
  "date": "2024-02-14",
  "cash": {
    "checking_account": 450000,
    "savings_account": 112000,
    "total": 562000,
    "history_7_days": [520000, 535000, 548000, 562000, 575000, 580000, 562000]
  },
  "revenue": {
    "this_month": 328000,
    "last_month": 315000,
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
  "accounts_receivable": {
    "total": 150000,
    "aging": {
      "0-30_days": 80000,
      "31-60_days": 50000,
      "over_60_days": 20000
    }
  },
  "accounts_payable": {
    "total": 125000,
    "due_this_week": 45000
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

### **2C: Upload Financial Summary (Excel/CSV)**

**File Format:** `financial_summary.xlsx` or `financial_summary.csv`

**Columns:**
```
metric          | value    | date       | category
----------------|----------|------------|----------
cash_balance    | 562000   | 2024-02-14 | assets
revenue_monthly | 328000   | 2024-02-14 | income
expenses_monthly| 234000   | 2024-02-14 | expenses
ar_total        | 150000   | 2024-02-14 | assets
ap_total        | 125000   | 2024-02-14 | liabilities
```

**Upload:**
```bash
curl -X POST "http://localhost:8000/api/cfo/upload/financial-summary" \
  -F "file=@financial_summary.xlsx"
```

---

## 🔌 **OPTION 3: Connect Accounting Software**

### **3A: QuickBooks Online**

**Step 1: Get OAuth Token**
```
1. Go to QuickBooks Developer Portal
2. Create an app
3. Get OAuth 2.0 credentials
4. Authorize and get access_token
```

**Step 2: Connect to Dashboard**
```http
POST /api/cfo/connect/accounting-software
  ?platform=quickbooks
  &access_token=YOUR_ACCESS_TOKEN
  &company_id=YOUR_COMPANY_ID
```

**Example:**
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
```

**What Gets Fetched:**
- ✅ Bank account balances
- ✅ Profit & Loss report
- ✅ Revenue by month
- ✅ Expenses by category
- ✅ Accounts Receivable aging
- ✅ Accounts Payable

---

### **3B: Xero**

**Step 1: Get OAuth Token**
```
1. Go to Xero Developer Portal
2. Create an app
3. Get OAuth 2.0 credentials
4. Authorize and get access_token
```

**Step 2: Connect to Dashboard**
```http
POST /api/cfo/connect/accounting-software
  ?platform=xero
  &access_token=YOUR_ACCESS_TOKEN
  &company_id=YOUR_TENANT_ID
```

**Example:**
```python
response = requests.post(
    'http://localhost:8000/api/cfo/connect/accounting-software',
    params={
        'platform': 'xero',
        'access_token': 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        'company_id': 'abc123-tenant-id'
    }
)
```

---

## 🔍 **Check Data Sources**

**Get list of connected data sources:**

```http
GET /api/cfo/data-sources
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
      "last_updated": "2024-02-14T10:30:00"
    },
    {
      "type": "quickbooks",
      "name": "QuickBooks Online",
      "status": "connected",
      "company_id": "1234567890"
    }
  ],
  "primary_source": "journal_entries"
}
```

---

## 📋 **Complete Data Structure**

The dashboard expects this JSON structure:

```typescript
interface DashboardData {
  healthScore: {
    overall: number;           // 0-100
    trend: number;             // % change
    breakdown: {
      liquidity: number;       // 0-100
      profitability: number;   // 0-100
      efficiency: number;      // 0-100
      stability: number;       // 0-100
    };
  };
  
  cash: {
    current: number;           // Dollar amount
    trend: number;             // % change
    runway: number;            // Months
    history: number[];         // Array of values
  };
  
  revenue: {
    monthly: number;           // This month
    arr: number;               // Annual Run Rate
    growth: number;            // % YoY
    history: number[];         // Last 6 months
  };
  
  expenses: {
    monthly: number;           // This month
    trend: number;             // % change
    categories: Array<{
      name: string;
      value: number;
      percentage: number;
    }>;
  };
  
  insights: Array<{
    icon: string;              // Emoji
    text: string;              // Insight text
    severity: 'info'|'warning'|'critical';
  }>;
  
  alerts: Array<{
    severity: 'critical'|'warning'|'info';
    message: string;
    time: string;
    action: string;
  }>;
  
  recentActivity: Array<{
    icon: string;
    action: string;
    time: string;
  }>;
  
  recommendations: Array<{
    priority: 'high'|'medium'|'low';
    text: string;
    impact: string;
  }>;
  
  ratios: {
    currentRatio: number;
    quickRatio: number;
    debtToEquity: number;
    roe: number;
    operatingMargin: number;
  };
}
```

---

## 🚀 **Quick Start Examples**

### **Example 1: Use Existing Journal Entries**
```bash
# Just open the dashboard - it auto-loads from sample_journal_entries.csv
http://localhost:3000/cfo-dashboard
```

### **Example 2: Upload Your Own Journal Entries**
```python
import requests

files = {'file': open('my_company_journal_entries.csv', 'rb')}
response = requests.post(
    'http://localhost:8000/api/cfo/upload/journal-entries',
    files=files
)

# Dashboard will now use your data
```

### **Example 3: Connect QuickBooks**
```python
# 1. Get OAuth token from QuickBooks
# 2. Connect:

requests.post(
    'http://localhost:8000/api/cfo/connect/accounting-software',
    params={
        'platform': 'quickbooks',
        'access_token': 'YOUR_TOKEN',
        'company_id': 'YOUR_COMPANY_ID'
    }
)

# 3. Refresh dashboard - it will pull from QuickBooks
```

---

## 🔐 **Environment Variables**

For accounting software connections, set these:

```bash
# QuickBooks
export QUICKBOOKS_ACCESS_TOKEN="your_token_here"
export QUICKBOOKS_COMPANY_ID="your_company_id"

# Xero
export XERO_ACCESS_TOKEN="your_token_here"
export XERO_TENANT_ID="your_tenant_id"
```

Or in `.env` file:
```
QUICKBOOKS_ACCESS_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
QUICKBOOKS_COMPANY_ID=1234567890
XERO_ACCESS_TOKEN=eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...
XERO_TENANT_ID=abc123-tenant-id
```

---

## 📊 **Data Flow Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│                   DATA INPUT OPTIONS                         │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
              ▼               ▼               ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │   Journal    │  │  Financial   │  │  Accounting  │
    │   Entries    │  │   Summary    │  │   Software   │
    │  (CSV/Excel) │  │ (JSON/Excel) │  │   (API)      │
    └──────────────┘  └──────────────┘  └──────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌──────────────────┐
                    │  CFO Metrics     │
                    │  Calculator      │
                    └──────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  Dashboard API   │
                    │  /api/cfo/*      │
                    └──────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │  React Frontend  │
                    │  CFO Dashboard   │
                    └──────────────────┘
```

---

## ✅ **Current Status**

**Working Now:**
- ✅ Option 1: Journal entries calculation
- ✅ Option 2: File upload endpoints
- ✅ Option 3: Accounting software integration code
- ✅ Mock data fallback

**To Activate:**
1. Place `sample_journal_entries.csv` in backend folder
2. Or upload your own files via API
3. Or connect QuickBooks/Xero with OAuth tokens

---

## 🎯 **Recommended Approach**

**For Testing:**
→ Use Option 1 (journal entries) - already set up!

**For Production:**
→ Use Option 3 (accounting software API) - real-time data

**For Custom Systems:**
→ Use Option 2 (upload financial summary JSON) - flexible format

---

## 📞 **API Endpoints Summary**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/cfo/dashboard` | GET | Get dashboard data |
| `/api/cfo/upload/journal-entries` | POST | Upload journal entries |
| `/api/cfo/upload/financial-summary` | POST | Upload financial summary |
| `/api/cfo/connect/accounting-software` | POST | Connect QuickBooks/Xero |
| `/api/cfo/data-sources` | GET | Check connected sources |
| `/api/cfo/export` | POST | Export dashboard report |
| `/api/cfo/insights` | GET | Get AI insights |
| `/api/cfo/forecast` | POST | Generate forecast |

---

**Your CFO Dashboard is ready to accept data from multiple sources!** 🚀
