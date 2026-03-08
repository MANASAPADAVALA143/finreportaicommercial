# Multi-Sheet Excel Test File Structure

Create an Excel file named `FPA_Data_MultiSheet.xlsx` with these 5 sheets:

## Sheet 1: Actual_TB (Trial Balance Format)
| Account Code | Account Name | Account Type | Debit | Credit |
|--------------|--------------|--------------|-------|--------|
| 1100 | Cash | Asset | 250000 | 0 |
| 1200 | Accounts Receivable | Asset | 180000 | 0 |
| 1300 | Inventory | Asset | 150000 | 0 |
| 2100 | Accounts Payable | Liability | 0 | 120000 |
| 3100 | Equity | Equity | 0 | 200000 |
| 4100 | Domestic Revenue | Revenue | 0 | 850000 |
| 4200 | Export Revenue | Revenue | 0 | 450000 |
| 4300 | Service Revenue | Revenue | 0 | 200000 |
| 5100 | Cost of Goods Sold | Expense | 650000 | 0 |
| 5200 | Payroll | Expense | 320000 | 0 |
| 5300 | Admin Expenses | Expense | 85000 | 0 |
| 5400 | Marketing | Expense | 65000 | 0 |
| 5500 | Rent | Expense | 48000 | 0 |
| 5600 | Depreciation | Expense | 35000 | 0 |

## Sheet 2: Budget (Trial Balance Format)
| Account Code | Account Name | Account Type | Debit | Credit |
|--------------|--------------|--------------|-------|--------|
| 1100 | Cash | Asset | 300000 | 0 |
| 1200 | Accounts Receivable | Asset | 200000 | 0 |
| 1300 | Inventory | Asset | 160000 | 0 |
| 2100 | Accounts Payable | Liability | 0 | 130000 |
| 3100 | Equity | Equity | 0 | 220000 |
| 4100 | Domestic Revenue | Revenue | 0 | 900000 |
| 4200 | Export Revenue | Revenue | 0 | 500000 |
| 4300 | Service Revenue | Revenue | 0 | 220000 |
| 5100 | Cost of Goods Sold | Expense | 700000 | 0 |
| 5200 | Payroll | Expense | 340000 | 0 |
| 5300 | Admin Expenses | Expense | 90000 | 0 |
| 5400 | Marketing | Expense | 70000 | 0 |
| 5500 | Rent | Expense | 50000 | 0 |
| 5600 | Depreciation | Expense | 38000 | 0 |

## Sheet 3: Monthly_Revenue (Monthly Format - NO Debit/Credit!)
| Month | Domestic_Revenue | Export_Revenue | Service_Revenue |
|-------|------------------|----------------|-----------------|
| Jan | 70000 | 35000 | 15000 |
| Feb | 72000 | 38000 | 16000 |
| Mar | 75000 | 40000 | 17000 |
| Apr | 71000 | 37000 | 16500 |
| May | 73000 | 39000 | 17500 |
| Jun | 74000 | 41000 | 18000 |
| Jul | 76000 | 42000 | 18500 |
| Aug | 77000 | 43000 | 19000 |
| Sep | 78000 | 44000 | 19500 |
| Oct | 79000 | 45000 | 20000 |
| Nov | 80000 | 46000 | 20500 |
| Dec | 85000 | 50000 | 22500 |

## Sheet 4: Department_Expenses (Department Format - NO Debit/Credit!)
| Department | Payroll | Admin | Distribution | Marketing | Rent | Other |
|------------|---------|-------|--------------|-----------|------|-------|
| Sales | 120000 | 15000 | 35000 | 45000 | 12000 | 8000 |
| Operations | 95000 | 20000 | 0 | 5000 | 15000 | 12000 |
| Finance | 55000 | 30000 | 0 | 2000 | 8000 | 5000 |
| IT | 50000 | 20000 | 0 | 13000 | 13000 | 10000 |

## Sheet 5: Scenario_Planning (Scenario Format - NO Debit/Credit!)
| Scenario | Revenue_Growth_% | COGS_% | Expense_Growth_% | Assumptions |
|----------|------------------|--------|------------------|-------------|
| Base Case | 8 | 45 | 5 | Conservative growth with stable margins |
| Optimistic | 15 | 42 | 8 | Market expansion, improved efficiency |
| Pessimistic | 3 | 48 | 10 | Economic downturn, cost pressures |
| Best Case | 20 | 40 | 6 | Major contract win, economies of scale |

---

## Expected Result After Upload:
✅ **5 sheets loaded successfully**

- Actual_TB → fpa_actual
- Budget → fpa_budget  
- Monthly_Revenue → fpa_forecast
- Department_Expenses → fpa_departments
- Scenario_Planning → fpa_scenarios

All FP&A modules should work with this data! 🎯
