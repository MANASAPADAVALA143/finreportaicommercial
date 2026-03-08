# 📤 Where to Upload Your Excel File

## ✅ **3 EASY WAYS TO UPLOAD**

---

## **METHOD 1: Via Web Interface** ⭐ (EASIEST - NEW!)

### **Step 1:** Open your browser
```
http://localhost:3000/upload-data
```

### **Step 2:** Click or drag your Excel file
- Accepts: `.xlsx`, `.xls`, `.csv`
- Your Trial Balance spreadsheet

### **Step 3:** Automatic redirect to dashboard
- See your data instantly!
- No command line needed!

**OR** Click the blue **"Upload Data"** button on the CFO Dashboard!

---

## **METHOD 2: Save File Directly** (FASTEST)

### **Location:**
```
C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend\trial_balance.csv
```

### **Steps:**
1. Open your Excel file
2. Click `File` → `Save As`
3. Navigate to: `C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend\`
4. File name: `trial_balance.csv`
5. Save as type: `CSV (Comma delimited)`
6. Click `Save`
7. Refresh browser (Ctrl+Shift+R)

**OR Save as Excel:**
```
C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend\trial_balance.xlsx
```
(Works with `.xlsx` too!)

---

## **METHOD 3: Upload via Python Script**

### **File Location:**
```
C:\Users\HCSUSER\OneDrive\Desktop\CFO\upload_trial_balance.py
```

### **Steps:**

**1. Edit the script:**
```python
# Open upload_trial_balance.py
# Change this line to your file path:
file_path = r"C:\Users\HCSUSER\Downloads\your_trial_balance.xlsx"
```

**2. Run the script:**
```powershell
cd C:\Users\HCSUSER\OneDrive\Desktop\CFO
python upload_trial_balance.py
```

**3. See results:**
```
✅ SUCCESS!
Your Dashboard Data:
  Cash: $812,450
  Revenue: $447,000
  Expenses: $305,000
```

---

## 📋 **Your Excel File Format**

### **Required Columns:**
```
Account Code | Account Name            | Account Type | Debit    | Credit
1000         | Cash                    | Asset        | 812450   | 0
1100         | Accounts Receivable     | Asset        | 420000   | 0
1200         | Inventory               | Asset        | 95000    | 0
2000         | Accounts Payable        | Liability    | 0        | 310000
2100         | Short-Term Debt         | Liability    | 0        | 250000
3000         | Equity                  | Equity       | 0        | 1200000
4000         | Revenue - Product       | Revenue      | 0        | 362000
4100         | Revenue - Services      | Revenue      | 0        | 85000
5000         | Marketing               | Expense      | 94000    | 0
5100         | Operations              | Expense      | 118000   | 0
5200         | Engineering             | Expense      | 64000    | 0
5300         | G&A Expenses            | Expense      | 29000    | 0
```

### **Column Rules:**

1. **Account Code** - Any numbering (1000, 2000, etc.)
2. **Account Name** - Descriptive name
3. **Account Type** - Must be: `Asset`, `Liability`, `Equity`, `Revenue`, or `Expense`
4. **Debit** - Amount or 0
5. **Credit** - Amount or 0

---

## 🎯 **RECOMMENDED METHOD:**

### **For First Time:**
→ Use **METHOD 1** (Web Upload at `/upload-data`)
- Visual feedback
- Error messages if something is wrong
- Automatic validation

### **For Regular Updates:**
→ Use **METHOD 2** (Direct File Save)
- Fastest
- Just save and refresh
- No extra steps

### **For Automation:**
→ Use **METHOD 3** (Python Script)
- Can schedule with Task Scheduler
- Automated uploads
- Scriptable

---

## 🔄 **WHAT HAPPENS AFTER UPLOAD:**

```
Your Excel File
     ↓
Parser Reads Data
     ↓
Extracts:
  • Cash: $812,450 (from Asset accounts)
  • Revenue: $447,000 (from Revenue accounts)
  • Expenses: $305,000 (from Expense accounts)
     ↓
Calculates:
  • Health Score: 66/100
  • Financial Ratios
  • Expense Breakdown
  • Runway: 2.7 months
     ↓
Dashboard Updates
     ↓
You See Your Data! 🎉
```

---

## ✅ **QUICK CHECKLIST:**

**Before uploading, verify:**
- [ ] File has 5 columns (Account Code, Account Name, Account Type, Debit, Credit)
- [ ] Account Types are spelled correctly (Asset, Liability, Equity, Revenue, Expense)
- [ ] Numbers are in correct columns (Assets/Expenses in Debit, Liabilities/Revenue in Credit)
- [ ] File is saved as CSV or Excel format

**After uploading:**
- [ ] Refresh browser (Ctrl+Shift+R)
- [ ] Check dashboard shows your numbers
- [ ] Verify calculations make sense

---

## 🚀 **TRY IT NOW!**

**Option 1: Web Upload**
```
1. Go to: http://localhost:3000/upload-data
2. Drag your Excel file
3. Wait 2 seconds
4. Dashboard shows your data!
```

**Option 2: Direct Save**
```
1. Save Excel as: C:\Users\HCSUSER\OneDrive\Desktop\CFO\backend\trial_balance.csv
2. Refresh browser
3. Done!
```

---

## 📞 **NEED HELP?**

**File won't upload:**
- Check file format (CSV or Excel)
- Verify column names match exactly
- Look for special characters

**Wrong numbers showing:**
- Check debit/credit placement
- Verify account types
- Refresh browser cache

**Dashboard shows $0:**
- File might not be in correct location
- Check account type spelling
- Try Method 1 (web upload) for error messages

---

## ✨ **BONUS TIP:**

You can upload different Trial Balances to compare:
1. Save last month as `trial_balance_jan.csv`
2. Upload current month
3. See month-over-month changes!

---

**Your CFO Dashboard is ready for YOUR data!** 🎉

Choose your method and upload now! ⬆️
