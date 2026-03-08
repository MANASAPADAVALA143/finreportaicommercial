"""
IFRS Mapper Service
AI-powered mapping of Trial Balance accounts to IFRS line items
"""

from typing import List, Dict, Optional, Any
import re


class IFRSMapper:
    """Service for mapping trial balance to IFRS statements"""
    
    def __init__(self):
        self.ifrs_structure = self._build_ifrs_structure()
        self.industry_templates = self._build_industry_templates()
        self.mapping_rules = self._build_mapping_rules()
    
    async def suggest_mappings(self, trial_balance: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Use AI logic to suggest IFRS mappings for trial balance accounts
        Returns mappings with confidence scores
        """
        mappings = []
        
        for account in trial_balance:
            gl_code = account.get('glCode', '')
            account_name = account.get('accountName', '').lower()
            account_type = account.get('accountType', '').lower()
            
            # Apply rule-based mapping with confidence scoring
            suggested_mapping, confidence = self._match_account_to_ifrs(
                gl_code, account_name, account_type
            )
            
            mappings.append({
                "glCode": gl_code,
                "accountName": account.get('accountName'),
                "suggestedMapping": suggested_mapping,
                "confidence": confidence,
                "status": self._get_mapping_status(confidence),
                "alternatives": self._get_alternative_mappings(account_name, account_type)
            })
        
        return {
            "mappings": mappings
        }
    
    def _match_account_to_ifrs(self, gl_code: str, account_name: str, account_type: str) -> tuple:
        """
        Match account to IFRS line item using intelligent rules
        Returns (mapping_path, confidence_score)
        """
        # High confidence mappings based on keywords
        high_confidence_rules = {
            # Assets
            'cash': ('financialPosition.assets.current.cashAndEquivalents', 95),
            'bank': ('financialPosition.assets.current.cashAndEquivalents', 95),
            'accounts receivable': ('financialPosition.assets.current.tradeReceivables', 95),
            'trade receivable': ('financialPosition.assets.current.tradeReceivables', 95),
            'inventory': ('financialPosition.assets.current.inventories', 95),
            'stock': ('financialPosition.assets.current.inventories', 90),
            'property, plant': ('financialPosition.assets.nonCurrent.ppe', 95),
            'ppe': ('financialPosition.assets.nonCurrent.ppe', 95),
            'equipment': ('financialPosition.assets.nonCurrent.ppe', 85),
            'intangible': ('financialPosition.assets.nonCurrent.intangibles', 95),
            'goodwill': ('financialPosition.assets.nonCurrent.intangibles', 95),
            
            # Liabilities
            'accounts payable': ('financialPosition.liabilities.current.tradePayables', 95),
            'trade payable': ('financialPosition.liabilities.current.tradePayables', 95),
            'short-term loan': ('financialPosition.liabilities.current.borrowings', 90),
            'current portion': ('financialPosition.liabilities.current.borrowings', 85),
            'long-term debt': ('financialPosition.liabilities.nonCurrent.borrowings', 95),
            'long-term loan': ('financialPosition.liabilities.nonCurrent.borrowings', 95),
            'deferred tax': ('financialPosition.liabilities.nonCurrent.deferredTax', 90),
            
            # Equity
            'share capital': ('financialPosition.equity.shareCapital', 95),
            'common stock': ('financialPosition.equity.shareCapital', 95),
            'retained earnings': ('financialPosition.equity.retainedEarnings', 95),
            'reserves': ('financialPosition.equity.reserves', 85),
            
            # Revenue
            'sales': ('profitLoss.revenue', 95),
            'revenue': ('profitLoss.revenue', 95),
            'income': ('profitLoss.revenue', 80),  # Could be other income
            'service revenue': ('profitLoss.revenue', 95),
            
            # Cost of Sales
            'cost of goods sold': ('profitLoss.costOfSales', 95),
            'cogs': ('profitLoss.costOfSales', 95),
            'cost of sales': ('profitLoss.costOfSales', 95),
            
            # Operating Expenses
            'salaries': ('profitLoss.operatingExpenses.employeeBenefits', 90),
            'wages': ('profitLoss.operatingExpenses.employeeBenefits', 90),
            'payroll': ('profitLoss.operatingExpenses.employeeBenefits', 90),
            'depreciation': ('profitLoss.operatingExpenses.depreciation', 95),
            'amortization': ('profitLoss.operatingExpenses.amortization', 95),
            'rent': ('profitLoss.operatingExpenses.administrative', 85),
            'marketing': ('profitLoss.operatingExpenses.distribution', 85),
            'advertising': ('profitLoss.operatingExpenses.distribution', 85),
            'administrative': ('profitLoss.operatingExpenses.administrative', 90),
            'office': ('profitLoss.operatingExpenses.administrative', 80),
            
            # Finance
            'interest expense': ('profitLoss.financeCosts', 95),
            'interest income': ('profitLoss.financeIncome', 95),
            
            # Tax
            'income tax': ('profitLoss.incomeTax', 95),
            'tax expense': ('profitLoss.incomeTax', 90),
        }
        
        # Check high confidence rules
        for keyword, (mapping, confidence) in high_confidence_rules.items():
            if keyword in account_name:
                return (mapping, confidence)
        
        # Fallback based on account type
        if account_type in ['asset', 'assets']:
            if any(word in account_name for word in ['current', 'short', 'receivable']):
                return ('financialPosition.assets.current.other', 60)
            return ('financialPosition.assets.nonCurrent.other', 55)
        
        elif account_type in ['liability', 'liabilities']:
            if any(word in account_name for word in ['current', 'short', 'payable']):
                return ('financialPosition.liabilities.current.other', 60)
            return ('financialPosition.liabilities.nonCurrent.other', 55)
        
        elif account_type in ['equity', 'capital']:
            return ('financialPosition.equity.reserves', 60)
        
        elif account_type in ['revenue', 'income']:
            return ('profitLoss.revenue', 70)
        
        elif account_type in ['expense', 'expenses']:
            return ('profitLoss.operatingExpenses.other', 60)
        
        # No match found
        return ('unmapped', 30)
    
    def _get_mapping_status(self, confidence: int) -> str:
        """Determine mapping status based on confidence"""
        if confidence >= 80:
            return 'mapped'
        elif confidence >= 50:
            return 'uncertain'
        else:
            return 'unmapped'
    
    def _get_alternative_mappings(self, account_name: str, account_type: str) -> List[Dict]:
        """Get alternative mapping suggestions"""
        alternatives = []
        
        # Provide context-aware alternatives
        if 'expense' in account_type.lower():
            alternatives = [
                {"path": "profitLoss.operatingExpenses.administrative", "label": "Administrative Expenses"},
                {"path": "profitLoss.operatingExpenses.distribution", "label": "Distribution Costs"},
                {"path": "profitLoss.operatingExpenses.other", "label": "Other Operating Expenses"}
            ]
        elif 'revenue' in account_type.lower() or 'income' in account_name.lower():
            alternatives = [
                {"path": "profitLoss.revenue", "label": "Revenue"},
                {"path": "profitLoss.otherIncome", "label": "Other Income"},
                {"path": "profitLoss.financeIncome", "label": "Finance Income"}
            ]
        
        return alternatives
    
    def generate_statements(
        self,
        trial_balance: List[Dict],
        mappings: Dict[str, str],
        entity_name: str,
        period_end: str,
        currency: str = "USD",
        prior_period: Optional[List[Dict]] = None
    ) -> Dict[str, Any]:
        """
        Generate complete IFRS financial statements
        """
        # Initialize statement structures
        statements = {
            "entityName": entity_name,
            "periodEnd": period_end,
            "currency": currency,
            "financialPosition": self._generate_financial_position(trial_balance, mappings),
            "profitLoss": self._generate_profit_loss(trial_balance, mappings),
            "cashFlows": self._generate_cash_flows(trial_balance, mappings),
            "changesInEquity": self._generate_equity_statement(trial_balance, mappings)
        }
        
        return statements
    
    def _generate_financial_position(self, trial_balance: List[Dict], mappings: Dict) -> Dict:
        """Generate Statement of Financial Position"""
        # Initialize categories
        assets = {
            "current": {"cashAndEquivalents": 0, "tradeReceivables": 0, "inventories": 0, "other": 0},
            "nonCurrent": {"ppe": 0, "intangibles": 0, "other": 0}
        }
        liabilities = {
            "current": {"tradePayables": 0, "borrowings": 0, "other": 0},
            "nonCurrent": {"borrowings": 0, "deferredTax": 0, "other": 0}
        }
        equity = {
            "shareCapital": 0,
            "retainedEarnings": 0,
            "reserves": 0
        }
        
        # Map trial balance entries
        for account in trial_balance:
            gl_code = account.get('glCode')
            mapping_path = mappings.get(gl_code, '')
            amount = account.get('debit', 0) - account.get('credit', 0)
            
            # Parse mapping path and allocate
            if 'financialPosition.assets.current.cashAndEquivalents' in mapping_path:
                assets['current']['cashAndEquivalents'] += amount
            elif 'financialPosition.assets.current.tradeReceivables' in mapping_path:
                assets['current']['tradeReceivables'] += amount
            elif 'financialPosition.assets.current.inventories' in mapping_path:
                assets['current']['inventories'] += amount
            elif 'financialPosition.assets.nonCurrent.ppe' in mapping_path:
                assets['nonCurrent']['ppe'] += amount
            elif 'financialPosition.assets.nonCurrent.intangibles' in mapping_path:
                assets['nonCurrent']['intangibles'] += amount
            elif 'financialPosition.liabilities.current.tradePayables' in mapping_path:
                liabilities['current']['tradePayables'] += abs(amount)
            elif 'financialPosition.liabilities.current.borrowings' in mapping_path:
                liabilities['current']['borrowings'] += abs(amount)
            elif 'financialPosition.liabilities.nonCurrent.borrowings' in mapping_path:
                liabilities['nonCurrent']['borrowings'] += abs(amount)
            elif 'financialPosition.equity.shareCapital' in mapping_path:
                equity['shareCapital'] += abs(amount)
            elif 'financialPosition.equity.retainedEarnings' in mapping_path:
                equity['retainedEarnings'] += abs(amount)
        
        # Calculate totals
        total_current_assets = sum(assets['current'].values())
        total_noncurrent_assets = sum(assets['nonCurrent'].values())
        total_assets = total_current_assets + total_noncurrent_assets
        
        total_current_liabilities = sum(liabilities['current'].values())
        total_noncurrent_liabilities = sum(liabilities['nonCurrent'].values())
        total_liabilities = total_current_liabilities + total_noncurrent_liabilities
        
        total_equity = sum(equity.values())
        
        return {
            "assets": {
                "current": assets['current'],
                "nonCurrent": assets['nonCurrent'],
                "totalCurrent": round(total_current_assets, 2),
                "totalNonCurrent": round(total_noncurrent_assets, 2),
                "total": round(total_assets, 2)
            },
            "liabilities": {
                "current": liabilities['current'],
                "nonCurrent": liabilities['nonCurrent'],
                "totalCurrent": round(total_current_liabilities, 2),
                "totalNonCurrent": round(total_noncurrent_liabilities, 2),
                "total": round(total_liabilities, 2)
            },
            "equity": {
                **equity,
                "total": round(total_equity, 2)
            },
            "totalEquityAndLiabilities": round(total_liabilities + total_equity, 2),
            "isBalanced": abs(total_assets - (total_liabilities + total_equity)) < 1
        }
    
    def _generate_profit_loss(self, trial_balance: List[Dict], mappings: Dict) -> Dict:
        """Generate Statement of Profit or Loss"""
        revenue = 0
        cost_of_sales = 0
        operating_expenses = {
            "employeeBenefits": 0,
            "depreciation": 0,
            "distribution": 0,
            "administrative": 0,
            "other": 0
        }
        finance_costs = 0
        finance_income = 0
        income_tax = 0
        
        for account in trial_balance:
            gl_code = account.get('glCode')
            mapping_path = mappings.get(gl_code, '')
            # For P&L: debit increases expenses, credit increases revenue
            debit = account.get('debit', 0)
            credit = account.get('credit', 0)
            
            if 'profitLoss.revenue' in mapping_path:
                revenue += credit
            elif 'profitLoss.costOfSales' in mapping_path:
                cost_of_sales += debit
            elif 'profitLoss.operatingExpenses.employeeBenefits' in mapping_path:
                operating_expenses['employeeBenefits'] += debit
            elif 'profitLoss.operatingExpenses.depreciation' in mapping_path:
                operating_expenses['depreciation'] += debit
            elif 'profitLoss.operatingExpenses.distribution' in mapping_path:
                operating_expenses['distribution'] += debit
            elif 'profitLoss.operatingExpenses.administrative' in mapping_path:
                operating_expenses['administrative'] += debit
            elif 'profitLoss.operatingExpenses' in mapping_path:
                operating_expenses['other'] += debit
            elif 'profitLoss.financeCosts' in mapping_path:
                finance_costs += debit
            elif 'profitLoss.financeIncome' in mapping_path:
                finance_income += credit
            elif 'profitLoss.incomeTax' in mapping_path:
                income_tax += debit
        
        # Calculate derived figures
        gross_profit = revenue - cost_of_sales
        total_operating_expenses = sum(operating_expenses.values())
        operating_profit = gross_profit - total_operating_expenses
        profit_before_tax = operating_profit - finance_costs + finance_income
        profit_after_tax = profit_before_tax - income_tax
        
        return {
            "revenue": round(revenue, 2),
            "costOfSales": round(cost_of_sales, 2),
            "grossProfit": round(gross_profit, 2),
            "operatingExpenses": {k: round(v, 2) for k, v in operating_expenses.items()},
            "totalOperatingExpenses": round(total_operating_expenses, 2),
            "operatingProfit": round(operating_profit, 2),
            "financeCosts": round(finance_costs, 2),
            "financeIncome": round(finance_income, 2),
            "profitBeforeTax": round(profit_before_tax, 2),
            "incomeTax": round(income_tax, 2),
            "profitAfterTax": round(profit_after_tax, 2)
        }
    
    def _generate_cash_flows(self, trial_balance: List[Dict], mappings: Dict) -> Dict:
        """Generate Statement of Cash Flows (Indirect Method) - Simplified"""
        # This is a simplified version - full implementation would need more data
        return {
            "operating": {
                "profitBeforeTax": 0,
                "adjustments": {},
                "netCashFromOperating": 0
            },
            "investing": {
                "purchaseOfPPE": 0,
                "netCashFromInvesting": 0
            },
            "financing": {
                "proceedsFromBorrowings": 0,
                "dividendsPaid": 0,
                "netCashFromFinancing": 0
            },
            "netIncreaseInCash": 0,
            "note": "Full cash flow statement requires additional transaction data"
        }
    
    def _generate_equity_statement(self, trial_balance: List[Dict], mappings: Dict) -> Dict:
        """Generate Statement of Changes in Equity - Simplified"""
        return {
            "shareCapital": {
                "openingBalance": 0,
                "movements": [],
                "closingBalance": 0
            },
            "retainedEarnings": {
                "openingBalance": 0,
                "profitForYear": 0,
                "dividends": 0,
                "closingBalance": 0
            },
            "note": "Full equity statement requires opening balances and movement data"
        }
    
    def get_ifrs_structure(self) -> Dict:
        """Get the complete IFRS statement structure"""
        return self.ifrs_structure
    
    def _build_ifrs_structure(self) -> Dict:
        """Build the hierarchical IFRS statement structure"""
        return {
            "financialPosition": {
                "name": "Statement of Financial Position",
                "sections": [
                    {
                        "id": "assets",
                        "name": "ASSETS",
                        "subsections": [
                            {
                                "id": "current",
                                "name": "Current Assets",
                                "items": [
                                    {"id": "cashAndEquivalents", "name": "Cash and Cash Equivalents"},
                                    {"id": "tradeReceivables", "name": "Trade and Other Receivables"},
                                    {"id": "inventories", "name": "Inventories"},
                                    {"id": "other", "name": "Other Current Assets"}
                                ]
                            },
                            {
                                "id": "nonCurrent",
                                "name": "Non-current Assets",
                                "items": [
                                    {"id": "ppe", "name": "Property, Plant and Equipment"},
                                    {"id": "intangibles", "name": "Intangible Assets"},
                                    {"id": "other", "name": "Other Non-current Assets"}
                                ]
                            }
                        ]
                    },
                    {
                        "id": "liabilities",
                        "name": "LIABILITIES",
                        "subsections": [
                            {
                                "id": "current",
                                "name": "Current Liabilities",
                                "items": [
                                    {"id": "tradePayables", "name": "Trade and Other Payables"},
                                    {"id": "borrowings", "name": "Short-term Borrowings"},
                                    {"id": "other", "name": "Other Current Liabilities"}
                                ]
                            },
                            {
                                "id": "nonCurrent",
                                "name": "Non-current Liabilities",
                                "items": [
                                    {"id": "borrowings", "name": "Long-term Borrowings"},
                                    {"id": "deferredTax", "name": "Deferred Tax Liabilities"},
                                    {"id": "other", "name": "Other Non-current Liabilities"}
                                ]
                            }
                        ]
                    },
                    {
                        "id": "equity",
                        "name": "EQUITY",
                        "items": [
                            {"id": "shareCapital", "name": "Share Capital"},
                            {"id": "retainedEarnings", "name": "Retained Earnings"},
                            {"id": "reserves", "name": "Other Reserves"}
                        ]
                    }
                ]
            },
            "profitLoss": {
                "name": "Statement of Profit or Loss",
                "items": [
                    {"id": "revenue", "name": "Revenue"},
                    {"id": "costOfSales", "name": "Cost of Sales"},
                    {"id": "grossProfit", "name": "Gross Profit", "calculated": True},
                    {
                        "id": "operatingExpenses",
                        "name": "Operating Expenses",
                        "subitems": [
                            {"id": "distribution", "name": "Distribution Costs"},
                            {"id": "administrative", "name": "Administrative Expenses"},
                            {"id": "employeeBenefits", "name": "Employee Benefits"},
                            {"id": "depreciation", "name": "Depreciation and Amortization"},
                            {"id": "other", "name": "Other Operating Expenses"}
                        ]
                    },
                    {"id": "operatingProfit", "name": "Operating Profit", "calculated": True},
                    {"id": "financeIncome", "name": "Finance Income"},
                    {"id": "financeCosts", "name": "Finance Costs"},
                    {"id": "profitBeforeTax", "name": "Profit Before Tax", "calculated": True},
                    {"id": "incomeTax", "name": "Income Tax Expense"},
                    {"id": "profitAfterTax", "name": "Profit for the Year", "calculated": True}
                ]
            }
        }
    
    def get_industry_templates(self, industry: Optional[str] = None) -> List[Dict]:
        """Get mapping templates for specific industries"""
        if industry:
            return [t for t in self.industry_templates if t['industry'].lower() == industry.lower()]
        return self.industry_templates
    
    def _build_industry_templates(self) -> List[Dict]:
        """Build pre-configured industry templates"""
        return [
            {
                "id": "retail",
                "name": "Retail & E-commerce",
                "industry": "Retail",
                "description": "Standard mappings for retail businesses with inventory",
                "icon": "ShoppingCart",
                "mappings": {
                    "1200": "financialPosition.assets.current.inventories",
                    "5000": "profitLoss.costOfSales",
                    "6200": "profitLoss.operatingExpenses.distribution"
                }
            },
            {
                "id": "saas",
                "name": "SaaS & Technology",
                "industry": "Technology",
                "description": "Mappings for SaaS companies with subscription revenue",
                "icon": "Cpu",
                "mappings": {
                    "4000": "profitLoss.revenue",
                    "6000": "profitLoss.operatingExpenses.employeeBenefits",
                    "6300": "profitLoss.operatingExpenses.administrative"
                }
            },
            {
                "id": "manufacturing",
                "name": "Manufacturing",
                "industry": "Manufacturing",
                "description": "Industrial manufacturing with WIP and finished goods",
                "icon": "Factory",
                "mappings": {
                    "1210": "financialPosition.assets.current.inventories",
                    "1220": "financialPosition.assets.current.inventories",
                    "5000": "profitLoss.costOfSales"
                }
            },
            {
                "id": "services",
                "name": "Professional Services",
                "industry": "Services",
                "description": "Consulting, legal, accounting, and other professional services",
                "icon": "Briefcase",
                "mappings": {
                    "4100": "profitLoss.revenue",
                    "6000": "profitLoss.operatingExpenses.employeeBenefits"
                }
            }
        ]
    
    def _build_mapping_rules(self) -> Dict:
        """Build intelligent mapping rules"""
        return {
            "keywords": {
                "high_priority": [],
                "medium_priority": [],
                "low_priority": []
            }
        }
