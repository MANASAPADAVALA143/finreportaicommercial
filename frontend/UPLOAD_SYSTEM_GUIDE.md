# 🎯 FP&A Multi-Format Upload System - Complete Guide

## ✅ What's Been Implemented

Your FP&A upload system now intelligently handles **4 different sheet formats** and **3 upload methods**.

---

## 📊 Supported Sheet Formats

### **Format 1: Trial Balance** (Actual_TB, Budget)
**Detection:** Has `Debit` or `Credit` columns  
**Columns Required:**
- Account Code
- Account Name  
- Account Type
- Debit
- Credit

**Saves to:** `fpa_actual` or `fpa_budget`

---

### **Format 2: Monthly Revenue** (Monthly_Revenue, Forecast)
**Detection:** Has `Month` column  
**Columns Required:**
- Month
- Domestic_Revenue
- Export_Revenue
- Service_Revenue

**NO Debit/Credit columns needed!**  
**Saves to:** `fpa_forecast`

---

### **Format 3: Department Expenses** (Department_Expenses, Departments)
**Detection:** Has `Department` column  
**Columns Required:**
- Department
- Payroll
- Admin
- Distribution
- Marketing
- Rent
- Other

**NO Debit/Credit columns needed!**  
**Saves to:** `fpa_departments`

---

### **Format 4: Scenario Planning** (Scenario_Planning, Scenarios)
**Detection:** Has `Scenario` column  
**Columns Required:**
- Scenario
- Revenue_Growth_%
- COGS_%
- Expense_Growth_%
- Assumptions (optional)

**NO Debit/Credit columns needed!**  
**Saves to:** `fpa_scenarios`

---

## 🚀 Upload Methods

### **Method 1: Smart Upload - Multi-Sheet Excel** ⭐ Recommended
1. Create Excel workbook with sheets named: `Actual_TB`, `Budget`, `Monthly_Revenue`, `Department_Expenses`, `Scenario_Planning`
2. Click **Smart Upload** button
3. Select your workbook
4. System auto-detects each sheet format by its columns
5. Result: **"✅ 5 sheets loaded successfully"**

All data saved to correct localStorage keys automatically!

---

### **Method 2: Smart Upload - Single Sheet with Classification**
1. Upload a single Excel/CSV file
2. System asks: "Which data is this?"
3. Select from dropdown:
   - Actual Trial Balance
   - Budget Data
   - Monthly Revenue / Forecast
   - Department Expenses
   - Scenario Planning
4. Click "Upload & Save"
5. Result: **"✅ Actual TB loaded — Variance Analysis ready"**

---

### **Method 3: Manual Upload - Individual Files**
1. Click **Manual Upload** tab
2. Upload separate files for each data type
3. Each slot shows which modules use that data
4. Clear/re-upload individual files as needed
5. Full control over each dataset

---

## 🔍 How Detection Works

The parser checks the first row's columns:

```typescript
// Detection Logic:
if (columns.includes('debit') || columns.includes('dr')) {
  → Parse as Trial Balance (TB format)
}
else if (columns.includes('month')) {
  → Parse as Monthly Revenue (time series)
}
else if (columns.includes('department') || columns.includes('dept')) {
  → Parse as Department Expenses (cost breakdown)
}
else if (columns.includes('scenario')) {
  → Parse as Scenario Planning (assumptions)
}
else {
  → Error: "Unrecognized sheet format"
}
```

**Column detection is case-insensitive** and flexible!

---

## 💾 Storage Keys (Shared Across All Modules)

All 3 upload methods save to the same localStorage keys:

| Data Type | Storage Key | Used By Modules |
|-----------|-------------|-----------------|
| Actual TB | `fpa_actual` | Variance, Forecasting, Scenario, KPI, Reports |
| Budget | `fpa_budget` | Variance, Budget Mgmt, Forecasting, KPI, Reports |
| Prior Year | `fpa_prior_year` | Variance (YoY), Budget Mgmt |
| Forecast | `fpa_forecast` | Forecasting Engine, Management Reports |
| Departments | `fpa_departments` | Budget Management, Management Reports |
| Scenarios | `fpa_scenarios` | Scenario Planning |

---

## 🧪 Testing Your Upload

### Test File Structure

See `test_multisheet_data.md` for a complete sample dataset with all 5 sheets.

### Quick Test:
1. Open `http://localhost:3001`
2. Navigate to **FP&A Suite**
3. Click **Upload Data** button
4. Try **Smart Upload** mode
5. Upload your multi-sheet Excel file
6. Verify: "✅ 5 sheets loaded successfully"
7. Check each module (Variance, Budget, Scenario) to see data loaded

---

## ⚠️ Error Handling

### If upload fails:

**Error:** "No recognized sheets found"
- **Fix:** Ensure sheet names match: `Actual_TB`, `Budget`, `Monthly_Revenue`, `Department_Expenses`, `Scenario_Planning`

**Error:** "Unrecognized sheet format"
- **Fix:** Check that each sheet has the required columns for its format

**Error:** "No valid data found"
- **Fix:** Ensure rows have data (not just headers)

**Error:** "Sheet is empty"
- **Fix:** Add data rows to the sheet

---

## 🎯 Why This Matters

Your app now supports **ANY CFO workflow**:

✅ **Enterprise CFOs** with one master Excel workbook → Upload once, done!  
✅ **Department heads** with separate CSV files → Upload one at a time  
✅ **Mixed workflows** → Switch between modes as needed  

All modules work regardless of which upload method you choose! 🚀

---

## 📝 Files Modified

1. `src/services/fpaDataService.ts` - Added format detection and specialized parsers
2. `src/components/fpa/MultiUploadModal.tsx` - Added 3-mode upload UI

## 🏆 Result

**Flexible, intelligent, and CFO-friendly upload system** that adapts to how your users actually work! 💼
