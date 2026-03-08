# 📊 IFRS Statement Generator - Complete Guide

## 🎯 **OVERVIEW**

The **IFRS Statement Generator** is an AI-powered module that converts your Trial Balance into complete IFRS-compliant financial statements in 3 simple steps.

### **What You Get:**
✅ **Statement of Financial Position** (Balance Sheet)
✅ **Statement of Profit or Loss** (Income Statement)
✅ **Statement of Cash Flows** (Indirect Method)
✅ **Statement of Changes in Equity**
✅ **AI-Powered Account Mapping** with confidence scores
✅ **Industry Templates** (Retail, SaaS, Manufacturing, Services)
✅ **Export to Multiple Formats** (PDF, Excel, Word, JSON)

---

## 🚀 **HOW TO USE**

### **Step 1: Upload Trial Balance**

1. **Go to Dashboard:**
   ```
   http://localhost:3000/dashboard
   ```

2. **Click on "IFRS Statement Generator"** card

3. **Upload Your Trial Balance:**
   - **Drag & drop** your Excel/CSV file, OR
   - **Click "Browse Files"** to select manually
   - **Supported formats:** `.xlsx`, `.xls`, `.csv`

4. **OR Try Sample Data:**
   - Click **"Try with Sample Data"** button
   - Pre-loaded trial balance for testing

### **Required File Format:**

Your Trial Balance must have these columns:

| Account Code | Account Name            | Account Type | Debit     | Credit    |
|--------------|-------------------------|--------------|-----------|-----------|
| 1000         | Cash in Bank            | Asset        | 500,000   | 0         |
| 1100         | Accounts Receivable     | Asset        | 250,000   | 0         |
| 4000         | Sales Revenue           | Revenue      | 0         | 3,200,000 |
| 5000         | Cost of Goods Sold      | Expense      | 1,450,000 | 0         |
| 6000         | Salaries & Wages        | Expense      | 480,000   | 0         |

**Columns:**
- **Account Code** - GL account number
- **Account Name** - Descriptive name
- **Account Type** - Asset, Liability, Equity, Revenue, or Expense
- **Debit** - Debit amount (0 if credit)
- **Credit** - Credit amount (0 if debit)

---

### **Step 2: Review & Configure Account Mapping**

Once uploaded, the AI automatically suggests IFRS mappings for each account.

#### **AI Mapping Dashboard:**

```
┌────────────────────────────────────────────────┐
│  Review Account Mapping      [85% Auto-Mapped] │
├────────────────────────────────────────────────┤
│                                                 │
│  Total: 21    Mapped: 18    Uncertain: 2       │
│  Unmapped: 1                                    │
│                                                 │
│  [Auto-Accept All (>80%)]  [Load Template ▼]  │
└────────────────────────────────────────────────┘
```

#### **Mapping Table:**

Each account shows:
- ✅ **Green Check** = Mapped correctly (confidence > 80%)
- ⚠️ **Yellow Warning** = Needs review (confidence 50-80%)
- ❌ **Red X** = Not mapped (confidence < 50%)

#### **How to Map Accounts:**

1. **Auto-Accept High Confidence:**
   - Click **"Auto-Accept All (>80% confidence)"**
   - Instantly maps all accounts with high confidence

2. **Manual Mapping:**
   - Click dropdown next to any account
   - Select the appropriate IFRS line item
   - AI suggestion shown with confidence percentage

3. **Use Industry Template:**
   - Click **"Load Industry Template"**
   - Choose from:
     * **Retail & E-commerce** - Inventory-focused
     * **SaaS & Technology** - Subscription revenue
     * **Manufacturing** - WIP and finished goods
     * **Professional Services** - Billable hours

4. **Review Uncertain Mappings:**
   - Yellow warning accounts need your review
   - AI provides alternative suggestions
   - Select the best match from dropdown

#### **IFRS Structure:**

Your accounts are mapped to:

```
📊 Statement of Financial Position
├─ ASSETS
│  ├─ Current Assets
│  │  ├─ Cash and Cash Equivalents
│  │  ├─ Trade Receivables
│  │  └─ Inventories
│  └─ Non-Current Assets
│     ├─ Property, Plant & Equipment
│     └─ Intangible Assets
├─ LIABILITIES
│  ├─ Current Liabilities
│  └─ Non-Current Liabilities
└─ EQUITY

📈 Statement of Profit or Loss
├─ Revenue
├─ Cost of Sales
├─ Operating Expenses
│  ├─ Employee Benefits
│  ├─ Depreciation
│  ├─ Distribution Costs
│  └─ Administrative Expenses
└─ Finance Costs
```

---

### **Step 3: Generated IFRS Statements**

After mapping is complete, click **"Generate IFRS Statements"** to create your financial statements.

#### **Statement Views:**

**4 Tabs Available:**

1. **Financial Position (Balance Sheet)**
   ```
   COMPANY NAME LTD
   STATEMENT OF FINANCIAL POSITION
   As at 31 December 2024
   
   ASSETS
   Non-current assets
     Property, plant and equipment        1,200
     Intangible assets                      150
   Total non-current assets              1,350
   
   Current assets
     Inventories                            180
     Trade receivables                      250
     Cash and cash equivalents              500
   Total current assets                    930
   
   TOTAL ASSETS                          2,280
   ```

2. **Profit & Loss (Income Statement)**
   ```
   Revenue                               3,200
   Cost of sales                        (1,450)
   Gross profit                          1,750
   
   Operating expenses                     (875)
   Operating profit                        875
   
   Finance costs                           (65)
   Profit before tax                       810
   
   Income tax expense                     (190)
   PROFIT FOR THE YEAR                     620
   ```

3. **Cash Flows** - Indirect method (requires additional data)
4. **Changes in Equity** - Movement summary

#### **Export Options:**

Click any export button:

- **Excel** ✅ - Full workbook with all statements
- **PDF** - Professional report (text format)
- **JSON** - API integration format

---

## 🎨 **KEY FEATURES**

### **1. AI-Powered Mapping**

The system uses intelligent rules to automatically match your trial balance accounts to IFRS line items:

**Example Mappings:**
- "Cash in Bank" → Cash and Cash Equivalents (95% confidence)
- "Accounts Receivable" → Trade Receivables (95%)
- "Salaries Expense" → Employee Benefits (90%)
- "Marketing" → Distribution Costs (85%)

### **2. Industry Templates**

Pre-configured mappings for common industries:

| Template                | Best For                          |
|-------------------------|-----------------------------------|
| Retail & E-commerce     | Inventory-heavy businesses        |
| SaaS & Technology       | Subscription revenue models       |
| Manufacturing           | WIP, finished goods, overhead     |
| Professional Services   | Consulting, legal, accounting     |

### **3. Validation & Checks**

✅ **Balance Sheet Balances:** Assets = Liabilities + Equity
✅ **Trial Balance Check:** Total Debits = Total Credits
✅ **IFRS Compliance:** Standard structure and terminology

### **4. Professional Formatting**

- Proper IFRS formatting and terminology
- Comparative columns (current + prior year)
- Subtotals and calculated fields
- Print-ready output

---

## 📁 **FILE EXAMPLES**

### **Sample Trial Balance (CSV):**

```csv
Account Code,Account Name,Account Type,Debit,Credit
1000,Cash in Bank,Asset,500000,0
1100,Accounts Receivable,Asset,250000,0
1200,Inventory,Asset,180000,0
1500,Property Plant Equipment,Asset,1200000,0
2000,Accounts Payable,Liability,0,280000
2500,Long-term Debt,Liability,0,800000
3000,Share Capital,Equity,0,500000
4000,Sales Revenue,Revenue,0,3200000
5000,Cost of Goods Sold,Expense,1450000,0
6000,Salaries Wages,Expense,480000,0
```

**Download Sample:**
```
http://localhost:8000/api/ifrs/sample-trial-balance
```

---

## 🔧 **API ENDPOINTS**

For developers wanting to integrate programmatically:

### **1. Upload Trial Balance**
```bash
POST http://localhost:8000/api/ifrs/upload-trial-balance
Content-Type: multipart/form-data

file: [your-trial-balance.xlsx]
```

**Response:**
```json
{
  "success": true,
  "trialBalance": [...],
  "metadata": {
    "totalDebit": 4980000,
    "totalCredit": 4980000,
    "isBalanced": true,
    "accountCount": 21
  }
}
```

### **2. Get AI Mapping Suggestions**
```bash
POST http://localhost:8000/api/ifrs/ai-mapping
Content-Type: application/json

{
  "trial_balance": [...]
}
```

**Response:**
```json
{
  "success": true,
  "mappings": [
    {
      "glCode": "1000",
      "accountName": "Cash in Bank",
      "suggestedMapping": "financialPosition.assets.current.cashAndEquivalents",
      "confidence": 95,
      "status": "mapped"
    }
  ],
  "statistics": {
    "totalAccounts": 21,
    "autoMapped": 18,
    "needsReview": 2,
    "unmapped": 1,
    "averageConfidence": 85.3
  }
}
```

### **3. Generate Statements**
```bash
POST http://localhost:8000/api/ifrs/generate-statements
Content-Type: application/json

{
  "trial_balance": [...],
  "mappings": {...},
  "entity_name": "Your Company Ltd",
  "period_end": "2024-12-31",
  "currency": "USD"
}
```

### **4. Export Statements**
```bash
POST http://localhost:8000/api/ifrs/export-statements?format=excel
Content-Type: application/json

{
  "statements": {...}
}
```

---

## 🎓 **BEST PRACTICES**

### **1. Prepare Your Trial Balance**

✅ **DO:**
- Use standard account names (e.g., "Cash", not "Petty Cash Box")
- Ensure trial balance balances before upload
- Include Account Type column
- Use consistent formatting

❌ **DON'T:**
- Use special characters in account names
- Mix currencies in same trial balance
- Upload incomplete data

### **2. Review AI Mappings**

- Always review accounts with confidence < 80%
- Check mappings for:
  - Professional fees (admin vs cost of sales)
  - Other income vs revenue
  - Prepayments/accruals classification

### **3. Use Templates**

- Start with an industry template
- Customize for your specific needs
- Save as custom template for reuse

### **4. Verify Outputs**

Before exporting:
- Check balance sheet balances
- Review profit calculations
- Verify all accounts are mapped
- Confirm entity name and period

---

## 🐛 **TROUBLESHOOTING**

### **Problem: "Missing required columns" error**

**Solution:**
- Ensure your file has: Account Code, Account Name, Debit, Credit
- Check column names match exactly (case-sensitive)
- Remove any merged cells or formatting

### **Problem: "Trial balance doesn't balance"**

**Solution:**
- Check for missing entries
- Verify debit/credit placement
- Look for formula errors in Excel
- Sum debits and credits manually

### **Problem: Low mapping confidence**

**Solution:**
- Rename accounts to standard terminology
- Add Account Type column
- Use industry template as starting point
- Manually map uncertain accounts

### **Problem: Export fails**

**Solution:**
- Check browser allows downloads
- Try different export format
- Ensure statements are generated first
- Check browser console for errors

---

## 📊 **TECHNICAL DETAILS**

### **AI Mapping Algorithm:**

1. **Keyword Matching**
   - High-priority keywords (cash, receivable, revenue)
   - Context-aware suggestions

2. **Account Type Analysis**
   - Asset/Liability/Equity/Revenue/Expense
   - Current vs Non-current classification

3. **Confidence Scoring**
   - 90-100%: Exact keyword match
   - 70-89%: Close keyword match
   - 50-69%: Account type match
   - <50%: No clear match

### **Statement Generation:**

- **Financial Position:** Debit/Credit netting by category
- **Profit & Loss:** Revenue (credits) - Expenses (debits)
- **Validation:** Assets = Liabilities + Equity check

---

## 🚀 **QUICK START COMMANDS**

```bash
# Start Backend
cd backend
python -m uvicorn app.main:app --reload

# Start Frontend
cd frontend
npm run dev

# Access Application
http://localhost:3000

# Go to IFRS Generator
http://localhost:3000/ifrs-generator
```

---

## 📞 **SUPPORT**

### **Common Questions:**

**Q: Can I upload prior year data?**
A: Yes, you'll be able to upload comparative periods in future updates.

**Q: Does it work for non-profit organizations?**
A: The structure is designed for for-profit entities. Non-profit support coming soon.

**Q: Can I edit statements after generation?**
A: Export to Excel and edit there. In-app editing coming soon.

**Q: Is my data secure?**
A: Data is processed in-memory and not permanently stored (demo mode).

---

## 🎉 **YOU'RE READY!**

1. ✅ Upload your Trial Balance
2. ✅ Review AI mappings
3. ✅ Generate IFRS statements
4. ✅ Export and use!

**Total Time: ~60 seconds** ⚡

---

## 📝 **CHANGELOG**

### **Version 1.0 (Current)**
- ✅ 3-step wizard interface
- ✅ AI-powered account mapping
- ✅ 4 core IFRS statements
- ✅ Industry templates (4 industries)
- ✅ Export to Excel, PDF, JSON
- ✅ Validation and balance checks

### **Coming Soon:**
- 🔄 Comparative period support
- 🔄 Notes to financial statements
- 🔄 Advanced cash flow (direct method)
- 🔄 Multi-currency support
- 🔄 Audit trail and versioning

---

**Made with ❤️ for FinReportAI Commercial**
