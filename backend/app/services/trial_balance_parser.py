"""
Trial Balance Parser for CFO Dashboard
Converts Trial Balance data to dashboard metrics
"""

import pandas as pd
from typing import Dict, Any
from datetime import datetime

class TrialBalanceParser:
    """Parse Trial Balance format to CFO Dashboard data"""
    
    def __init__(self, file_path: str):
        """Initialize with path to Trial Balance CSV/Excel"""
        if file_path.endswith('.csv'):
            self.df = pd.read_csv(file_path)
        else:
            self.df = pd.read_excel(file_path)
        
        # Standardize column names
        self.df.columns = [col.strip().lower().replace(' ', '_') for col in self.df.columns]
    
    def calculate_dashboard_metrics(self) -> Dict[str, Any]:
        """Calculate all CFO dashboard metrics from Trial Balance"""
        
        return {
            "healthScore": self._calculate_health_score(),
            "cash": self._calculate_cash_metrics(),
            "revenue": self._calculate_revenue_metrics(),
            "expenses": self._calculate_expense_metrics(),
            "insights": self._generate_insights(),
            "alerts": self._generate_alerts(),
            "recentActivity": self._get_recent_activity(),
            "recommendations": self._generate_recommendations(),
            "ratios": self._calculate_financial_ratios()
        }
    
    def _calculate_cash_metrics(self) -> Dict[str, Any]:
        """Extract cash position from Trial Balance"""
        
        # Find cash accounts (account type = Asset, account name contains Cash)
        cash_accounts = self.df[
            (self.df['account_type'].str.contains('Asset', case=False, na=False)) &
            (self.df['account_name'].str.contains('Cash', case=False, na=False))
        ]
        
        # Cash is debit balance for assets
        total_cash = cash_accounts['debit'].sum() - cash_accounts['credit'].sum()
        
        # Calculate monthly expenses for runway
        expense_accounts = self.df[
            self.df['account_type'].str.contains('Expense', case=False, na=False)
        ]
        monthly_expenses = expense_accounts['debit'].sum() - expense_accounts['credit'].sum()
        
        # Calculate runway (months)
        runway = (total_cash / monthly_expenses) if monthly_expenses > 0 else 999
        
        # Mock historical data (would come from previous trial balances)
        history = [
            int(total_cash * 0.85),
            int(total_cash * 0.90),
            int(total_cash * 0.93),
            int(total_cash * 0.96),
            int(total_cash * 0.98),
            int(total_cash * 0.99),
            int(total_cash)
        ]
        
        # Calculate trend
        trend = ((history[-1] - history[-2]) / history[-2] * 100) if history[-2] != 0 else 0
        
        return {
            "current": int(total_cash),
            "trend": round(trend, 1),
            "runway": round(runway, 1),
            "history": history
        }
    
    def _calculate_revenue_metrics(self) -> Dict[str, Any]:
        """Extract revenue from Trial Balance"""
        
        # Find revenue accounts
        revenue_accounts = self.df[
            self.df['account_type'].str.contains('Revenue', case=False, na=False)
        ]
        
        # Revenue is credit balance
        total_revenue = revenue_accounts['credit'].sum() - revenue_accounts['debit'].sum()
        
        # Annualize (ARR)
        arr = total_revenue * 12
        
        # Mock historical data
        history = [
            int(total_revenue * 0.70),
            int(total_revenue * 0.78),
            int(total_revenue * 0.85),
            int(total_revenue * 0.91),
            int(total_revenue * 0.96),
            int(total_revenue)
        ]
        
        # Calculate growth
        growth = ((history[-1] - history[-2]) / history[-2] * 100) if history[-2] != 0 else 0
        
        return {
            "monthly": int(total_revenue),
            "arr": int(arr),
            "growth": round(growth, 1),
            "history": history
        }
    
    def _calculate_expense_metrics(self) -> Dict[str, Any]:
        """Extract expenses from Trial Balance"""
        
        # Find expense accounts
        expense_accounts = self.df[
            self.df['account_type'].str.contains('Expense', case=False, na=False)
        ]
        
        # Expenses are debit balance
        total_expenses = expense_accounts['debit'].sum() - expense_accounts['credit'].sum()
        
        # Break down by category
        categories = []
        expense_breakdown = {}
        
        for _, row in expense_accounts.iterrows():
            account_name = row['account_name']
            amount = row['debit'] - row['credit']
            
            # Categorize based on account name
            if 'Marketing' in account_name:
                category = 'Marketing'
            elif 'Operation' in account_name or 'Operations' in account_name:
                category = 'Operations'
            elif 'Engineering' in account_name or 'R&D' in account_name:
                category = 'R&D'
            elif 'G&A' in account_name or 'Admin' in account_name:
                category = 'G&A'
            else:
                category = 'Other'
            
            if category not in expense_breakdown:
                expense_breakdown[category] = 0
            expense_breakdown[category] += amount
        
        # Convert to list format
        for category, value in expense_breakdown.items():
            percentage = (value / total_expenses * 100) if total_expenses > 0 else 0
            categories.append({
                "name": category,
                "value": int(value),
                "percentage": round(percentage, 1)
            })
        
        # Sort by value descending
        categories.sort(key=lambda x: x['value'], reverse=True)
        
        # Calculate trend (mock for now)
        trend = 8.2
        
        return {
            "monthly": int(total_expenses),
            "trend": trend,
            "categories": categories
        }
    
    def _calculate_health_score(self) -> Dict[str, Any]:
        """Calculate financial health score"""
        
        # Get key metrics
        cash = self._calculate_cash_metrics()
        revenue = self._calculate_revenue_metrics()
        expenses = self._calculate_expense_metrics()
        ratios = self._calculate_financial_ratios()
        
        # Calculate component scores (0-100)
        
        # Liquidity: Based on current ratio and cash runway
        liquidity = min(100, (ratios['currentRatio'] / 2 * 50) + (min(cash['runway'], 12) / 12 * 50))
        
        # Profitability: Based on revenue vs expenses
        profit_margin = ((revenue['monthly'] - expenses['monthly']) / revenue['monthly'] * 100) if revenue['monthly'] > 0 else 0
        profitability = min(100, max(0, profit_margin + 50))
        
        # Efficiency: Based on operating margin
        efficiency = min(100, ratios['operatingMargin'] * 2)
        
        # Stability: Based on debt-to-equity and trends
        stability = min(100, (1 - ratios['debtToEquity']) * 100)
        
        # Overall score (weighted average)
        overall = (liquidity * 0.3 + profitability * 0.3 + efficiency * 0.2 + stability * 0.2)
        
        return {
            "overall": round(overall),
            "trend": 2.5,
            "breakdown": {
                "liquidity": round(liquidity),
                "profitability": round(profitability),
                "efficiency": round(efficiency),
                "stability": round(stability)
            }
        }
    
    def _calculate_financial_ratios(self) -> Dict[str, float]:
        """Calculate key financial ratios"""
        
        # Get account balances
        assets = self.df[self.df['account_type'].str.contains('Asset', case=False, na=False)]
        liabilities = self.df[self.df['account_type'].str.contains('Liability', case=False, na=False)]
        equity = self.df[self.df['account_type'].str.contains('Equity', case=False, na=False)]
        revenue = self.df[self.df['account_type'].str.contains('Revenue', case=False, na=False)]
        expenses = self.df[self.df['account_type'].str.contains('Expense', case=False, na=False)]
        
        total_assets = assets['debit'].sum() - assets['credit'].sum()
        total_liabilities = liabilities['credit'].sum() - liabilities['debit'].sum()
        total_equity = equity['credit'].sum() - equity['debit'].sum()
        total_revenue = revenue['credit'].sum() - revenue['debit'].sum()
        total_expenses = expenses['debit'].sum() - expenses['credit'].sum()
        
        # Current assets/liabilities (simplified - would need more detail)
        current_assets = total_assets * 0.6  # Assume 60% is current
        current_liabilities = total_liabilities * 0.7  # Assume 70% is current
        
        # Calculate ratios
        current_ratio = current_assets / current_liabilities if current_liabilities > 0 else 0
        quick_ratio = (current_assets * 0.75) / current_liabilities if current_liabilities > 0 else 0
        debt_to_equity = total_liabilities / total_equity if total_equity > 0 else 0
        
        net_income = total_revenue - total_expenses
        roe = (net_income / total_equity * 100) if total_equity > 0 else 0
        operating_margin = (net_income / total_revenue * 100) if total_revenue > 0 else 0
        
        return {
            "currentRatio": round(current_ratio, 1),
            "quickRatio": round(quick_ratio, 1),
            "debtToEquity": round(debt_to_equity, 1),
            "roe": round(roe, 1),
            "operatingMargin": round(operating_margin, 1)
        }
    
    def _generate_insights(self) -> list:
        """Generate AI insights"""
        return [
            {"icon": "💰", "text": "Strong cash position maintained", "severity": "info"},
            {"icon": "📈", "text": "Revenue growing steadily", "severity": "info"}
        ]
    
    def _generate_alerts(self) -> list:
        """Generate alerts"""
        return [
            {"severity": "info", "message": "Financial statements imported successfully", "time": "Just now", "action": "View"}
        ]
    
    def _get_recent_activity(self) -> list:
        """Get recent activity"""
        return [
            {"icon": "📄", "action": "Trial Balance imported", "time": "Just now"},
            {"icon": "📊", "action": "Dashboard metrics calculated", "time": "Just now"}
        ]
    
    def _generate_recommendations(self) -> list:
        """Generate recommendations"""
        
        cash = self._calculate_cash_metrics()
        revenue = self._calculate_revenue_metrics()
        expenses = self._calculate_expense_metrics()
        
        recommendations = []
        
        # Cash-based recommendations
        if cash['runway'] < 12:
            recommendations.append({
                "priority": "high",
                "text": f"Extend runway from {cash['runway']:.1f} months",
                "impact": "+3 months runway"
            })
        
        # Revenue-based recommendations
        if revenue['growth'] > 15:
            recommendations.append({
                "priority": "medium",
                "text": "Strong growth - consider scaling operations",
                "impact": "+20% revenue potential"
            })
        
        # Expense-based recommendations
        if expenses['monthly'] > revenue['monthly'] * 0.8:
            recommendations.append({
                "priority": "high",
                "text": "High expense ratio - optimize spending",
                "impact": "Improve margins by 10%"
            })
        
        return recommendations


# Example usage
if __name__ == "__main__":
    parser = TrialBalanceParser("trial_balance.csv")
    metrics = parser.calculate_dashboard_metrics()
    print("Dashboard metrics:", metrics)
