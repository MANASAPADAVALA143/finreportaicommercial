// Mock budget data for FY2025
export const budgetLineItems = [
    // Revenue Section
    {
        id: 'rev-header',
        category: 'Revenue',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 30000000, feb: 28000000, mar: 32000000,
            apr: 29000000, may: 31000000, jun: 33000000,
            jul: 30000000, aug: 29000000, sep: 31000000,
            oct: 32000000, nov: 30000000, dec: 35000000
        },
        priorYearActual: 338000000
    },
    {
        id: 'rev-domestic',
        category: 'Domestic Sales',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Sales',
        monthly: {
            jan: 18000000, feb: 17000000, mar: 19000000,
            apr: 17500000, may: 18500000, jun: 20000000,
            jul: 18000000, aug: 17500000, sep: 19000000,
            oct: 19500000, nov: 18000000, dec: 21000000
        },
        priorYearActual: 204000000
    },
    {
        id: 'rev-export',
        category: 'Export Sales',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Sales',
        monthly: {
            jan: 12000000, feb: 11000000, mar: 13000000,
            apr: 11500000, may: 12500000, jun: 13000000,
            jul: 12000000, aug: 11500000, sep: 12000000,
            oct: 12500000, nov: 12000000, dec: 14000000
        },
        priorYearActual: 134000000
    },
    // Cost of Sales
    {
        id: 'cogs-header',
        category: 'Cost of Sales',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 15000000, feb: 14000000, mar: 16000000,
            apr: 14500000, may: 15500000, jun: 16500000,
            jul: 15000000, aug: 14500000, sep: 15500000,
            oct: 16000000, nov: 15000000, dec: 17500000
        },
        priorYearActual: 169000000
    },
    {
        id: 'cogs-raw-materials',
        category: 'Raw Materials',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Operations',
        monthly: {
            jan: 9000000, feb: 8500000, mar: 9500000,
            apr: 8700000, may: 9300000, jun: 10000000,
            jul: 9000000, aug: 8700000, sep: 9300000,
            oct: 9600000, nov: 9000000, dec: 10500000
        },
        priorYearActual: 101000000
    },
    {
        id: 'cogs-direct-labor',
        category: 'Direct Labor',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Operations',
        monthly: {
            jan: 4000000, feb: 3800000, mar: 4200000,
            apr: 3900000, may: 4100000, jun: 4300000,
            jul: 4000000, aug: 3900000, sep: 4100000,
            oct: 4200000, nov: 4000000, dec: 4500000
        },
        priorYearActual: 45000000
    },
    {
        id: 'cogs-manufacturing',
        category: 'Manufacturing Overhead',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Operations',
        monthly: {
            jan: 2000000, feb: 1700000, mar: 2300000,
            apr: 1900000, may: 2100000, jun: 2200000,
            jul: 2000000, aug: 1900000, sep: 2100000,
            oct: 2200000, nov: 2000000, dec: 2500000
        },
        priorYearActual: 23000000
    },
    // Gross Profit (calculated)
    {
        id: 'gross-profit',
        category: 'Gross Profit',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 15000000, feb: 14000000, mar: 16000000,
            apr: 14500000, may: 15500000, jun: 16500000,
            jul: 15000000, aug: 14500000, sep: 15500000,
            oct: 16000000, nov: 15000000, dec: 17500000
        },
        priorYearActual: 169000000
    },
    // Operating Expenses
    {
        id: 'opex-header',
        category: 'Operating Expenses',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 8500000, feb: 8200000, mar: 8800000,
            apr: 8400000, may: 8600000, jun: 8900000,
            jul: 8500000, aug: 8400000, sep: 8600000,
            oct: 8800000, nov: 8500000, dec: 9200000
        },
        priorYearActual: 95000000
    },
    {
        id: 'opex-salaries',
        category: 'Employee Salaries',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'HR',
        monthly: {
            jan: 4500000, feb: 4500000, mar: 4500000,
            apr: 4500000, may: 4500000, jun: 4500000,
            jul: 4500000, aug: 4500000, sep: 4500000,
            oct: 4500000, nov: 4500000, dec: 4500000
        },
        priorYearActual: 48000000
    },
    {
        id: 'opex-marketing',
        category: 'Marketing & Advertising',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Marketing',
        monthly: {
            jan: 1500000, feb: 1400000, mar: 1600000,
            apr: 1500000, may: 1500000, jun: 1600000,
            jul: 1500000, aug: 1500000, sep: 1500000,
            oct: 1600000, nov: 1500000, dec: 1700000
        },
        priorYearActual: 16000000
    },
    {
        id: 'opex-admin',
        category: 'Administrative Expenses',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Finance',
        monthly: {
            jan: 900000, feb: 850000, mar: 950000,
            apr: 900000, may: 900000, jun: 950000,
            jul: 900000, aug: 900000, sep: 900000,
            oct: 950000, nov: 900000, dec: 1000000
        },
        priorYearActual: 9500000
    },
    {
        id: 'opex-it',
        category: 'IT & Technology',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'IT',
        monthly: {
            jan: 700000, feb: 650000, mar: 750000,
            apr: 700000, may: 700000, jun: 750000,
            jul: 700000, aug: 700000, sep: 700000,
            oct: 750000, nov: 700000, dec: 800000
        },
        priorYearActual: 7500000
    },
    {
        id: 'opex-rent',
        category: 'Rent & Utilities',
        isHeader: false,
        isEditable: true,
        indent: 1,
        department: 'Finance',
        monthly: {
            jan: 900000, feb: 800000, mar: 1000000,
            apr: 900000, may: 1000000, jun: 1100000,
            jul: 900000, aug: 900000, sep: 1000000,
            oct: 1000000, nov: 900000, dec: 1200000
        },
        priorYearActual: 10000000
    },
    // EBITDA (calculated)
    {
        id: 'ebitda',
        category: 'EBITDA',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 6500000, feb: 5800000, mar: 7200000,
            apr: 6100000, may: 6900000, jun: 7600000,
            jul: 6500000, aug: 6100000, sep: 6900000,
            oct: 7200000, nov: 6500000, dec: 8300000
        },
        priorYearActual: 74000000
    },
    // Depreciation & Amortization
    {
        id: 'da',
        category: 'Depreciation & Amortization',
        isHeader: false,
        isEditable: true,
        indent: 0,
        department: 'Finance',
        monthly: {
            jan: 500000, feb: 500000, mar: 500000,
            apr: 500000, may: 500000, jun: 500000,
            jul: 500000, aug: 500000, sep: 500000,
            oct: 500000, nov: 500000, dec: 500000
        },
        priorYearActual: 6000000
    },
    // Operating Profit
    {
        id: 'op-profit',
        category: 'Operating Profit',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 6000000, feb: 5300000, mar: 6700000,
            apr: 5600000, may: 6400000, jun: 7100000,
            jul: 6000000, aug: 5600000, sep: 6400000,
            oct: 6700000, nov: 6000000, dec: 7800000
        },
        priorYearActual: 68000000
    },
    // Finance Costs
    {
        id: 'finance-costs',
        category: 'Finance Costs',
        isHeader: false,
        isEditable: true,
        indent: 0,
        department: 'Finance',
        monthly: {
            jan: 300000, feb: 300000, mar: 300000,
            apr: 300000, may: 300000, jun: 300000,
            jul: 300000, aug: 300000, sep: 300000,
            oct: 300000, nov: 300000, dec: 300000
        },
        priorYearActual: 3600000
    },
    // Profit Before Tax
    {
        id: 'pbt',
        category: 'Profit Before Tax',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 5700000, feb: 5000000, mar: 6400000,
            apr: 5300000, may: 6100000, jun: 6800000,
            jul: 5700000, aug: 5300000, sep: 6100000,
            oct: 6400000, nov: 5700000, dec: 7500000
        },
        priorYearActual: 64400000
    },
    // Income Tax
    {
        id: 'tax',
        category: 'Income Tax (30%)',
        isHeader: false,
        isEditable: true,
        indent: 0,
        department: 'Finance',
        monthly: {
            jan: 1710000, feb: 1500000, mar: 1920000,
            apr: 1590000, may: 1830000, jun: 2040000,
            jul: 1710000, aug: 1590000, sep: 1830000,
            oct: 1920000, nov: 1710000, dec: 2250000
        },
        priorYearActual: 19320000
    },
    // Net Profit
    {
        id: 'net-profit',
        category: 'NET PROFIT',
        isHeader: true,
        isEditable: false,
        indent: 0,
        monthly: {
            jan: 3990000, feb: 3500000, mar: 4480000,
            apr: 3710000, may: 4270000, jun: 4760000,
            jul: 3990000, aug: 3710000, sep: 4270000,
            oct: 4480000, nov: 3990000, dec: 5250000
        },
        priorYearActual: 45080000
    }
];
// Budget versions
export const budgetVersions = [
    {
        id: 'v1',
        name: 'Budget v1 (Draft)',
        createdDate: '2025-01-15',
        createdBy: 'John Smith',
        status: 'Draft',
        isCurrent: false
    },
    {
        id: 'v2',
        name: 'Budget v2 (Revised)',
        createdDate: '2025-02-01',
        createdBy: 'Sarah Johnson',
        status: 'Under Review',
        isCurrent: false
    },
    {
        id: 'v3',
        name: 'Budget v3 (Final)',
        createdDate: '2025-02-15',
        createdBy: 'Michael Chen',
        status: 'Approved',
        isCurrent: true
    }
];
// Department budgets
export const departmentBudgets = [
    {
        department: 'Sales',
        totalBudget: 5000000,
        priorYearActual: 4800000,
        variance: 200000,
        variancePct: 4.17,
        status: 'Approved'
    },
    {
        department: 'HR',
        totalBudget: 54000000,
        priorYearActual: 48000000,
        variance: 6000000,
        variancePct: 12.5,
        status: 'Approved'
    },
    {
        department: 'IT',
        totalBudget: 9000000,
        priorYearActual: 7500000,
        variance: 1500000,
        variancePct: 20,
        status: 'Under Review'
    },
    {
        department: 'Marketing',
        totalBudget: 18400000,
        priorYearActual: 16000000,
        variance: 2400000,
        variancePct: 15,
        status: 'Approved'
    },
    {
        department: 'Operations',
        totalBudget: 185000000,
        priorYearActual: 169000000,
        variance: 16000000,
        variancePct: 9.47,
        status: 'Approved'
    },
    {
        department: 'Finance',
        totalBudget: 25500000,
        priorYearActual: 23100000,
        variance: 2400000,
        variancePct: 10.39,
        status: 'Approved'
    }
];
// Budget summary
export const budgetSummary = {
    totalRevenue: 370000000,
    totalExpenses: 295400000,
    netProfit: 50400000,
    ebitda: 81600000,
    priorYearRevenue: 338000000,
    priorYearExpenses: 270000000,
    priorYearNetProfit: 45080000,
    priorYearEbitda: 74000000
};
