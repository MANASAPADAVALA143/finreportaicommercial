# 🧠 CFO Decision Intelligence - Upload Guide

## ✅ Feature Added: Bulk Data Upload

You can now upload a **multi-sheet Excel file** to populate all 8 CFO Decision Intelligence modules at once!

---

## 📊 Excel File Structure

Your Excel file should contain up to **8 sheets** with the following names:

### Sheet 1: **Investment_Decisions**
**Columns:**
- Project_Name (text)
- Investment (number)
- Yearly_Revenue (number)
- Yearly_Cost (number)
- Discount_Rate (number, e.g., 12 for 12%)
- Project_Years (number)

**Example:**
| Project_Name | Investment | Yearly_Revenue | Yearly_Cost | Discount_Rate | Project_Years |
|--------------|------------|----------------|-------------|---------------|---------------|
| New Factory | 50000000 | 20000000 | 12000000 | 12 | 5 |
| ERP System | 15000000 | 8000000 | 3000000 | 15 | 3 |

---

### Sheet 2: **Build_vs_Buy**
**Columns:**
- Requirement (text)
- Build_Initial_Cost (number)
- Build_Monthly_Cost (number)
- Build_Time_Months (number)
- Buy_Initial_Cost (number)
- Buy_Monthly_Cost (number)
- Buy_Time_Months (number)
- Project_Years (number)

**Example:**
| Requirement | Build_Initial_Cost | Build_Monthly_Cost | Build_Time_Months | Buy_Initial_Cost | Buy_Monthly_Cost | Buy_Time_Months | Project_Years |
|-------------|-------------------|-------------------|------------------|-----------------|-----------------|----------------|---------------|
| CRM Software | 5000000 | 150000 | 12 | 2000000 | 200000 | 3 | 5 |

---

### Sheet 3: **Internal_vs_External**
**Columns:**
- Function_Name (text)
- Current_Team (number)
- Cost_Per_Person (number)
- Current_Time (number, hours)
- Error_Rate (number, %)
- Vendor_Monthly_Cost (number)
- Vendor_SLA (number, hours)
- Vendor_Error_Rate (number, %)

**Example:**
| Function_Name | Current_Team | Cost_Per_Person | Current_Time | Error_Rate | Vendor_Monthly_Cost | Vendor_SLA | Vendor_Error_Rate |
|---------------|--------------|----------------|--------------|-----------|-------------------|-----------|------------------|
| Payroll Processing | 3 | 600000 | 48 | 5 | 150000 | 24 | 1 |

---

### Sheet 4: **Hire_vs_Automate**
**Columns:**
- Role (text)
- Annual_Salary (number)
- Benefits (number)
- Headcount (number)
- Software_Cost (number)
- Implementation_Cost (number)
- Tasks_Per_Day (number)
- Automation_Rate (number, %)

**Example:**
| Role | Annual_Salary | Benefits | Headcount | Software_Cost | Implementation_Cost | Tasks_Per_Day | Automation_Rate |
|------|--------------|---------|-----------|--------------|-------------------|--------------|----------------|
| Data Entry Clerk | 400000 | 50000 | 5 | 500000 | 300000 | 100 | 80 |

---

### Sheet 5: **Cost_Cut_vs_Invest**
**Columns:**
- Scenario (text)
- Current_Revenue (number)
- Cost_Cut_Amount (number)
- Cost_Cut_Impact (text)
- Invest_Amount (number)
- Invest_ROI (number, %)
- Time_Horizon (number, years)

**Example:**
| Scenario | Current_Revenue | Cost_Cut_Amount | Cost_Cut_Impact | Invest_Amount | Invest_ROI | Time_Horizon |
|----------|----------------|----------------|----------------|--------------|-----------|-------------|
| Marketing Budget | 330000000 | 5000000 | 10% revenue drop | 10000000 | 25 | 2 |

---

### Sheet 6: **Capital_Allocation**
**Columns:**
- Scenario (text)
- Total_Capital (number)
- Product_Dev (number)
- Market_Expansion (number)
- Debt_Repayment (number)
- M&A (number)
- Cash_Reserve (number)

**Example:**
| Scenario | Total_Capital | Product_Dev | Market_Expansion | Debt_Repayment | M&A | Cash_Reserve |
|----------|--------------|-------------|-----------------|---------------|-----|-------------|
| Aggressive Growth | 100000000 | 40000000 | 30000000 | 10000000 | 15000000 | 5000000 |

---

### Sheet 7: **Risk_Dashboard**
**Columns:**
- Risk_Category (text)
- Risk_Description (text)
- Likelihood (number, 1-10)
- Impact (number, 1-10)
- Current_Mitigation (text)
- Risk_Score (number)

**Example:**
| Risk_Category | Risk_Description | Likelihood | Impact | Current_Mitigation | Risk_Score |
|--------------|-----------------|-----------|--------|-------------------|-----------|
| Financial | Currency fluctuation | 7 | 8 | Hedging contracts | 56 |

---

### Sheet 8: **Decision_Audit_Trail**
**Columns:**
- Date (date, YYYY-MM-DD)
- Type (text: investment, build_vs_buy, etc.)
- Title (text)
- AI_Outcome (text: approve, reject, conditional)
- CFO_Outcome (text: approve, reject, conditional)
- Confidence (number, %)
- Tracked (boolean: TRUE/FALSE)
- AI_Correct (boolean: TRUE/FALSE, optional)

**Example:**
| Date | Type | Title | AI_Outcome | CFO_Outcome | Confidence | Tracked | AI_Correct |
|------|------|-------|-----------|------------|-----------|---------|-----------|
| 2026-03-01 | investment | New Factory | approve | approve | 85 | TRUE | TRUE |

---

## 🎯 How to Use

1. **Click "Upload Data"** button in CFO Decision Intelligence header
2. **Select your Excel file** (must have .xlsx or .xls extension)
3. **Wait for processing** - you'll see which sheets were loaded
4. **Success!** All modules will now use your uploaded data

---

## 💡 Tips

- **Sheet names are case-insensitive** - "Investment_Decisions", "investment_decisions", or "Investment" all work
- **You don't need all 8 sheets** - upload only the ones you have data for
- **Numeric values** can include currency symbols (₹) or commas - they'll be parsed correctly
- **Empty rows** are automatically skipped
- **First row** should contain column headers

---

## 📥 Sample Excel Template

A sample Excel template with all required sheets and columns is coming soon!

---

## 🔄 Data Storage

- All uploaded data is stored in **browser localStorage**
- Data persists across page refreshes
- Each sheet is saved to a separate localStorage key:
  - `cfo_decision_investment`
  - `cfo_decision_build_vs_buy`
  - `cfo_decision_internal_vs_external`
  - `cfo_decision_hire_vs_automate`
  - `cfo_decision_cost_cut_vs_invest`
  - `cfo_decision_capital_allocation`
  - `cfo_decision_risks`
  - `cfo_decision_audit_trail`

---

## ⚠️ Troubleshooting

**"No valid sheets found"**
- Check that your sheet names match the expected names above
- Ensure sheets contain data (not just headers)

**"Upload failed"**
- Check that your file is a valid Excel file (.xlsx or .xls)
- Ensure column names match the expected format
- Make sure numeric columns contain valid numbers

---

## 🎉 What's Next?

After uploading, all 8 decision modules will automatically use your data for analysis and recommendations!
