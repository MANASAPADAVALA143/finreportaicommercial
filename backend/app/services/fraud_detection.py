from typing import Dict, List, Tuple
from datetime import datetime, timedelta
import re
from app.core.config import settings


class FraudDetectionService:
    """Service for detecting fraudulent financial transactions."""
    
    def __init__(self):
        self.risk_keywords = [
            'cash', 'petty', 'misc', 'sundry', 'various', 'adjusting',
            'correction', 'reversal', 'rounding', 'discretionary'
        ]
        
        self.high_risk_accounts = [
            'cash', 'petty_cash', 'miscellaneous', 'suspense'
        ]
    
    def analyze_transaction(self, entry: Dict, historical_entries: List[Dict] = None) -> Dict:
        """
        Comprehensive fraud analysis of a transaction.
        
        Returns:
            Dict containing fraud_score, risk_level, and detected_patterns
        """
        risk_factors = []
        fraud_score = 0.0
        
        # 1. Amount Analysis
        amount_risk, amount_factors = self._analyze_amount(entry)
        fraud_score += amount_risk
        risk_factors.extend(amount_factors)
        
        # 2. Description Analysis
        desc_risk, desc_factors = self._analyze_description(entry)
        fraud_score += desc_risk
        risk_factors.extend(desc_factors)
        
        # 3. Account Analysis
        account_risk, account_factors = self._analyze_account(entry)
        fraud_score += account_risk
        risk_factors.extend(account_factors)
        
        # 4. Timing Analysis
        timing_risk, timing_factors = self._analyze_timing(entry)
        fraud_score += timing_risk
        risk_factors.extend(timing_factors)
        
        # 5. Pattern Analysis (if historical data available)
        if historical_entries:
            pattern_risk, pattern_factors = self._analyze_patterns(entry, historical_entries)
            fraud_score += pattern_risk
            risk_factors.extend(pattern_factors)
        
        # Normalize fraud score (0-1)
        fraud_score = min(fraud_score / 5.0, 1.0)
        
        # Determine risk level
        if fraud_score >= settings.FRAUD_THRESHOLD_HIGH:
            risk_level = "high"
        elif fraud_score >= settings.FRAUD_THRESHOLD_MEDIUM:
            risk_level = "medium"
        else:
            risk_level = "low"
        
        return {
            "fraud_score": fraud_score,
            "risk_level": risk_level,
            "risk_factors": risk_factors,
            "requires_review": fraud_score >= settings.FRAUD_THRESHOLD_MEDIUM
        }
    
    def _analyze_amount(self, entry: Dict) -> Tuple[float, List[str]]:
        """Analyze transaction amounts for suspicious patterns."""
        risk = 0.0
        factors = []
        
        debit = float(entry.get('debit', 0))
        credit = float(entry.get('credit', 0))
        amount = max(debit, credit)
        
        # Round number detection (e.g., 10000, 5000)
        if amount > 0 and amount % 1000 == 0:
            risk += 0.2
            factors.append("Round amount detected")
        
        # Just below threshold amounts
        if 9900 <= amount <= 9999:
            risk += 0.4
            factors.append("Amount just below common approval threshold")
        
        # Unusually large amount
        if amount > 100000:
            risk += 0.3
            factors.append("Unusually large amount")
        
        # Unbalanced entry
        if debit > 0 and credit > 0:
            risk += 0.5
            factors.append("Both debit and credit present (unusual)")
        
        return risk, factors
    
    def _analyze_description(self, entry: Dict) -> Tuple[float, List[str]]:
        """Analyze transaction description for suspicious patterns."""
        risk = 0.0
        factors = []
        
        description = entry.get('description', '').lower()
        
        # Check for vague descriptions
        if len(description) < 10:
            risk += 0.3
            factors.append("Vague or minimal description")
        
        # Check for risk keywords
        for keyword in self.risk_keywords:
            if keyword in description:
                risk += 0.2
                factors.append(f"High-risk keyword detected: '{keyword}'")
                break
        
        # Check for unusual characters
        if re.search(r'[^a-zA-Z0-9\s\-,.]', description):
            risk += 0.1
            factors.append("Unusual characters in description")
        
        return risk, factors
    
    def _analyze_account(self, entry: Dict) -> Tuple[float, List[str]]:
        """Analyze account for high-risk indicators."""
        risk = 0.0
        factors = []
        
        account = entry.get('account', '').lower()
        
        # Check high-risk accounts
        for high_risk in self.high_risk_accounts:
            if high_risk in account:
                risk += 0.4
                factors.append(f"High-risk account type: {high_risk}")
                break
        
        return risk, factors
    
    def _analyze_timing(self, entry: Dict) -> Tuple[float, List[str]]:
        """Analyze transaction timing for suspicious patterns."""
        risk = 0.0
        factors = []
        
        entry_date = entry.get('entry_date')
        if isinstance(entry_date, str):
            entry_date = datetime.fromisoformat(entry_date.replace('Z', '+00:00'))
        
        # Weekend transactions
        if entry_date.weekday() >= 5:
            risk += 0.2
            factors.append("Transaction posted on weekend")
        
        # Late night transactions (after 10 PM or before 6 AM)
        hour = entry_date.hour
        if hour >= 22 or hour <= 6:
            risk += 0.2
            factors.append("Transaction posted during off-hours")
        
        # End of period transactions
        if entry_date.day >= 28:
            risk += 0.1
            factors.append("End-of-period transaction")
        
        return risk, factors
    
    def _analyze_patterns(self, entry: Dict, historical: List[Dict]) -> Tuple[float, List[str]]:
        """Analyze for suspicious patterns across transactions."""
        risk = 0.0
        factors = []
        
        if not historical:
            return risk, factors
        
        # Check for duplicate entries
        duplicates = self._check_duplicates(entry, historical)
        if duplicates:
            risk += 0.5
            factors.append(f"Potential duplicate detected ({duplicates} similar entries)")
        
        # Check for splitting (multiple small transactions)
        splitting = self._check_splitting(entry, historical)
        if splitting:
            risk += 0.4
            factors.append("Potential amount splitting detected")
        
        # Check for unusual frequency
        frequency_risk = self._check_frequency(entry, historical)
        if frequency_risk:
            risk += 0.3
            factors.append("Unusual transaction frequency")
        
        return risk, factors
    
    def _check_duplicates(self, entry: Dict, historical: List[Dict]) -> int:
        """Check for duplicate or near-duplicate transactions."""
        duplicates = 0
        entry_amount = max(float(entry.get('debit', 0)), float(entry.get('credit', 0)))
        entry_desc = entry.get('description', '').lower()
        
        for hist in historical[-20:]:  # Check last 20 entries
            hist_amount = max(float(hist.get('debit', 0)), float(hist.get('credit', 0)))
            hist_desc = hist.get('description', '').lower()
            
            if (abs(entry_amount - hist_amount) < 0.01 and 
                entry_desc == hist_desc):
                duplicates += 1
        
        return duplicates
    
    def _check_splitting(self, entry: Dict, historical: List[Dict]) -> bool:
        """Check for amount splitting (circumventing approval limits)."""
        entry_amount = max(float(entry.get('debit', 0)), float(entry.get('credit', 0)))
        entry_date = entry.get('entry_date')
        
        if isinstance(entry_date, str):
            entry_date = datetime.fromisoformat(entry_date.replace('Z', '+00:00'))
        
        # Look for multiple transactions of similar amounts within 24 hours
        similar_count = 0
        for hist in historical[-10:]:
            hist_amount = max(float(hist.get('debit', 0)), float(hist.get('credit', 0)))
            hist_date = hist.get('entry_date')
            
            if isinstance(hist_date, str):
                hist_date = datetime.fromisoformat(hist_date.replace('Z', '+00:00'))
            
            if (abs(entry_amount - hist_amount) < entry_amount * 0.1 and
                abs((entry_date - hist_date).total_seconds()) < 86400):
                similar_count += 1
        
        return similar_count >= 3
    
    def _check_frequency(self, entry: Dict, historical: List[Dict]) -> bool:
        """Check for unusual transaction frequency."""
        if len(historical) < 5:
            return False
        
        entry_account = entry.get('account')
        account_entries = [h for h in historical if h.get('account') == entry_account]
        
        # If more than 10 entries to same account in last historical set
        return len(account_entries) > 10


# Singleton instance
fraud_detection_service = FraudDetectionService()
