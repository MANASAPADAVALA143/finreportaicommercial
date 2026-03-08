# 🔧 COMPLETE GUIDE: Replacing Mock Data with Real Data in ALL FP&A Modules

## ✅ Modules Already Fixed

### 1. **Variance Analysis** ✅ 
- **Status:** Using real data from localStorage
- **Function:** `convertToVarianceData()` converts actual + budget → variance rows
- **Result:** Shows real revenue, expenses, variances

### 2. **KPI Dashboard** ✅
- **Status:** Using real data from localStorage  
- **Function:** `calculateRealKPIs()` calculates all KPIs from actual + budget
- **Result:** Shows real KPIs (revenue, profitability, liquidity, efficiency)

---

## ⏳ Modules Still Using Mock Data

### 3. **Budget Management** ⚠️
**Current Issue:** Uses `budgetLineItems` from `budgetMockData.ts`

**Fix Needed:**
```typescript
// BEFORE (line 41):
const [budgetData, setBudgetData] = useState<BudgetLineItem[]>(budgetLineItems);

// AFTER:
const [budgetData, setBudgetData] = useState<BudgetLineItem[]>([]);

useEffect(() => {
  if (budgetDataFromStorage) {
    // Convert budgetDataFromStorage to BudgetLineItem[] format
    const converted = convertBudgetDataToLineItems(budgetDataFromStorage);
    setBudgetData(converted);
  }
}, [budgetDataFromStorage]);

// Add conversion function:
const convertBudgetDataToLineItems = (data: any): BudgetLineItem[] => {
  return [
    {
      id: 'revenue-domestic',
      category: 'Revenue',
      lineItem: 'Domestic Revenue',
      department: 'Sales',
      monthly: generateMonthlyFromTotal(data.domesticRevenue),
      fy2025Budget: data.domesticRevenue,
      fy2024Actual: data.domesticRevenue * 0.9, // Estimate if no prior year
      variance: 0,
      variancePct: 0,
      status: 'On Track',
      isEditable: true
    },
    // ... add all other line items
  ];
};
```

---

### 4. **Forecasting Engine** ⚠️
**Current Issue:** Uses hardcoded `revenueForecastData` and `expenseForecastData`

**Mock Data Location:**
```typescript
// frontend/src/data/forecastingMockData.ts
export const revenueForecastData = [...] // HARDCODED
```

**Fix Needed:**
```typescript
// Load real data
const actualData = loadFPAActual();
const budgetData = loadFPABudget();
const forecastData = loadFPAForecast(); // Monthly revenue data

// If no data uploaded:
if (!actualData || !budgetData) {
  return (
    <div className="empty-state">
      <AlertTriangle />
      <p>Upload Actual and Budget data to see forecasts</p>
      <button onClick={() => navigate('/fpa')}>Upload Data</button>
    </div>
  );
}

// Generate forecast from real data:
const generateForecastFromReal = (actual: any, budget: any, monthly: any) => {
  // Use actual monthly revenue data if available
  if (monthly && monthly.months) {
    return monthly.months.map((month: string, idx: number) => ({
      month,
      actual: monthly.domesticRevenue[idx] + monthly.exportRevenue[idx],
      budget: budget.totalRevenue / 12,
      forecast: calculateForecast(monthly, idx),
      isActual: idx < 10 // Oct = month 10
    }));
  }
  
  // Otherwise use actual + budget to project
  return generateDefaultForecast(actual, budget);
};
```

---

### 5. **Scenario Planning** ⚠️
**Current Issue:** Uses hardcoded baseline revenue (line 348: `40000000`)

**Fix Needed:**
```typescript
// BEFORE:
const openingCash = uploadedData?.cashAndEquivalents || 40000000; // HARDCODED

// AFTER:
const actualData = loadFPAActual();
if (!actualData) {
  return <div>Please upload Actual TB to run scenarios</div>;
}

const openingCash = actualData.cashAndEquivalents;
const baseRevenue = actualData.totalRevenue;
const baseCOGS = actualData.costOfGoodsSold;
const baseOpex = actualData.totalOperatingExpenses;

// Use real data as baseline for all scenarios
const scenarios = [
  {
    name: 'Base Case',
    revenue: baseRevenue * 1.08, // 8% growth from REAL data
    cogs: baseCOGS * 1.05,
    opex: baseOpex * 1.05
  },
  // ...
];
```

---

### 6. **Management Reports** ⚠️
**Current Issue:** Uses hardcoded numbers in board pack sections

**Fix Needed:**
```typescript
// BEFORE:
const initialSections = [
  {
    title: 'Financial Summary',
    metrics: [
      { label: 'Revenue', value: '₹42.5Cr', change: '+12%' }, // HARDCODED
      // ...
    ]
  }
];

// AFTER:
const actualData = loadFPAActual();
const budgetData = loadFPABudget();

if (!actualData || !budgetData) {
  return <EmptyState message="Upload data to generate reports" />;
}

const generateReportSections = (actual: any, budget: any) => {
  return [
    {
      title: 'Financial Summary',
      metrics: [
        {
          label: 'Revenue',
          value: formatCurrency(actual.totalRevenue),
          change: calculateVariancePct(actual.totalRevenue, budget.totalRevenue)
        },
        {
          label: 'Gross Profit',
          value: formatCurrency(actual.totalRevenue - actual.costOfGoodsSold),
          change: calculateGPMarginChange(actual, budget)
        },
        // ... generate from REAL data
      ]
    }
  ];
};

const initialSections = generateReportSections(actualData, budgetData);
```

---

## 🎯 Universal Pattern to Apply

### Step 1: Load Real Data
```typescript
const actualData = loadFPAActual();
const budgetData = loadFPABudget();
const forecastData = loadFPAForecast();
```

### Step 2: Check if Data Exists
```typescript
if (!actualData) {
  return (
    <div className="p-8 text-center bg-yellow-50 rounded-xl">
      <AlertTriangle className="w-12 h-12 mx-auto text-yellow-600 mb-4" />
      <h3 className="text-lg font-semibold">No Data Uploaded</h3>
      <p className="text-gray-600 mt-2">
        Upload your Trial Balance to see {moduleName}
      </p>
      <button 
        onClick={() => navigate('/fpa')}
        className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg"
      >
        📤 Upload Data Now
      </button>
    </div>
  );
}
```

### Step 3: Calculate from Real Data
```typescript
// NEVER use hardcoded values
const revenue = actualData.totalRevenue; // ✅ Real data
const budget = budgetData.totalRevenue;  // ✅ Real data

const variance = revenue - budget;
const variancePct = (variance / budget) * 100;

// Use these calculated values everywhere
```

### Step 4: Remove All Mock Imports
```typescript
// DELETE THESE:
import { mockData } from '../../data/mockData';
import { demoRevenue, demoExpenses } from '../../data/demo';

// ONLY KEEP:
import { loadFPAActual, loadFPABudget } from '../../utils/fpaDataLoader';
```

---

## 📋 Checklist for Each Module

- [ ] Replace mock data imports with `loadFPAActual()` / `loadFPABudget()`
- [ ] Add empty state when no data exists
- [ ] Remove ALL hardcoded numbers (revenue, expenses, etc.)
- [ ] Calculate everything from uploaded data
- [ ] Test upload → verify real numbers show
- [ ] Test without upload → verify empty state shows

---

## 🚀 Testing Steps

1. **Clear localStorage:** 
   ```javascript
   localStorage.clear();
   ```

2. **Open module WITHOUT uploading data:**
   - Should show: "⚠️ No data uploaded yet"
   - Should NOT show: any hardcoded numbers

3. **Upload Trial Balance:**
   - Go to FP&A Suite → Upload Data
   - Upload Actual_TB and Budget sheets

4. **Refresh module:**
   - Should show: YOUR real revenue, expenses, KPIs
   - Should NOT show: demo/mock data

5. **Verify numbers match uploaded file:**
   - Check revenue = sum of revenue accounts in TB
   - Check expenses = sum of expense accounts in TB
   - Check variances = actual - budget

---

## 💾 Data Flow Summary

```
User uploads Excel
     ↓
parseTrialBalance() extracts data
     ↓
localStorage.setItem('fpa_actual', JSON.stringify(data))
     ↓
Module calls loadFPAActual()
     ↓
Module calculates KPIs/variances from real data
     ↓
Display real numbers ✅
```

**NO MOCK DATA ANYWHERE!** 🎯

---

## ⚠️ Common Mistakes to Avoid

❌ **DON'T:**
```typescript
const revenue = uploadedData?.revenue || 42000000; // BAD!
const expenses = actualData?.expenses || demoExpenses; // BAD!
```

✅ **DO:**
```typescript
if (!actualData) return <EmptyState />;
const revenue = actualData.totalRevenue; // GOOD!
const expenses = actualData.totalOperatingExpenses; // GOOD!
```

---

## 📝 Files to Update

| Module | File | Status |
|--------|------|--------|
| Variance Analysis | `VarianceAnalysis.tsx` | ✅ DONE |
| KPI Dashboard | `KPIDashboard.tsx` | ✅ DONE |
| Budget Management | `BudgetManagement.tsx` | ⏳ TODO |
| Forecasting Engine | `ForecastingEngine.tsx` | ⏳ TODO |
| Scenario Planning | `ScenarioPlanning.tsx` | ⏳ TODO |
| Management Reports | `ManagementReporting.tsx` | ⏳ TODO |

---

This guide ensures ZERO hardcoded data across the entire FP&A suite! 🎉
