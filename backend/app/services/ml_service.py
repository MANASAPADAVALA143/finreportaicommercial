import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from typing import Dict, List, Tuple
import pickle
import os


class MLService:
    """Machine Learning service for financial analytics."""
    
    def __init__(self):
        self.anomaly_detector = IsolationForest(
            contamination=0.1,
            random_state=42,
            n_estimators=100
        )
        self.fraud_classifier = None
        self.scaler = StandardScaler()
        self.is_trained = False
    
    def train_anomaly_detector(self, historical_data: pd.DataFrame):
        """Train anomaly detection model on historical journal entries."""
        features = self._extract_features(historical_data)
        scaled_features = self.scaler.fit_transform(features)
        self.anomaly_detector.fit(scaled_features)
        self.is_trained = True
    
    def detect_anomaly(self, entry_data: Dict) -> Tuple[bool, float]:
        """
        Detect if a journal entry is anomalous.
        
        Returns:
            Tuple of (is_anomaly, anomaly_score)
        """
        if not self.is_trained:
            return False, 0.0
        
        features = self._extract_single_entry_features(entry_data)
        scaled_features = self.scaler.transform([features])
        
        # Get anomaly prediction (-1 for anomaly, 1 for normal)
        prediction = self.anomaly_detector.predict(scaled_features)[0]
        
        # Get anomaly score (negative values are anomalies)
        score = self.anomaly_detector.score_samples(scaled_features)[0]
        
        # Normalize score to 0-1 range (higher = more anomalous)
        normalized_score = 1 / (1 + np.exp(score))
        
        return prediction == -1, float(normalized_score)
    
    def _extract_features(self, df: pd.DataFrame) -> np.ndarray:
        """Extract features from journal entries DataFrame."""
        features = []
        
        for _, row in df.iterrows():
            features.append([
                float(row.get('debit', 0)),
                float(row.get('credit', 0)),
                abs(float(row.get('debit', 0)) - float(row.get('credit', 0))),
                len(str(row.get('description', ''))),
                hash(str(row.get('account', ''))) % 1000,  # Account encoding
            ])
        
        return np.array(features)
    
    def _extract_single_entry_features(self, entry: Dict) -> List[float]:
        """Extract features from a single journal entry."""
        return [
            float(entry.get('debit', 0)),
            float(entry.get('credit', 0)),
            abs(float(entry.get('debit', 0)) - float(entry.get('credit', 0))),
            len(str(entry.get('description', ''))),
            hash(str(entry.get('account', ''))) % 1000,
        ]
    
    def analyze_financial_ratios(self, financial_data: Dict) -> Dict:
        """Calculate and analyze key financial ratios."""
        ratios = {}
        
        try:
            # Liquidity Ratios
            current_assets = financial_data.get('current_assets', 0)
            current_liabilities = financial_data.get('current_liabilities', 1)
            ratios['current_ratio'] = current_assets / current_liabilities
            
            # Profitability Ratios
            net_income = financial_data.get('net_income', 0)
            revenue = financial_data.get('revenue', 1)
            ratios['profit_margin'] = (net_income / revenue) * 100
            
            # Efficiency Ratios
            total_assets = financial_data.get('total_assets', 1)
            ratios['asset_turnover'] = revenue / total_assets
            
            # Leverage Ratios
            total_debt = financial_data.get('total_debt', 0)
            total_equity = financial_data.get('total_equity', 1)
            ratios['debt_to_equity'] = total_debt / total_equity
            
            # Return Ratios
            ratios['roa'] = (net_income / total_assets) * 100
            ratios['roe'] = (net_income / total_equity) * 100
            
        except ZeroDivisionError:
            pass
        
        return ratios
    
    def trend_analysis(self, time_series_data: List[Dict]) -> Dict:
        """Perform trend analysis on financial time series."""
        if not time_series_data:
            return {"trend": "insufficient_data"}
        
        df = pd.DataFrame(time_series_data)
        
        analysis = {
            "growth_rate": self._calculate_growth_rate(df),
            "volatility": self._calculate_volatility(df),
            "seasonality": self._detect_seasonality(df),
            "forecast": self._simple_forecast(df)
        }
        
        return analysis
    
    def _calculate_growth_rate(self, df: pd.DataFrame) -> float:
        """Calculate compound annual growth rate."""
        if len(df) < 2:
            return 0.0
        
        values = df['value'].values
        periods = len(values) - 1
        
        if values[0] == 0:
            return 0.0
        
        cagr = ((values[-1] / values[0]) ** (1 / periods) - 1) * 100
        return float(cagr)
    
    def _calculate_volatility(self, df: pd.DataFrame) -> float:
        """Calculate volatility (standard deviation)."""
        return float(df['value'].std())
    
    def _detect_seasonality(self, df: pd.DataFrame) -> bool:
        """Simple seasonality detection."""
        if len(df) < 12:
            return False
        
        # Simple autocorrelation check
        values = df['value'].values
        mean = np.mean(values)
        
        if len(values) >= 12:
            correlation = np.corrcoef(values[:-12], values[12:])[0, 1]
            return abs(correlation) > 0.5
        
        return False
    
    def _simple_forecast(self, df: pd.DataFrame, periods: int = 3) -> List[float]:
        """Simple moving average forecast."""
        if len(df) < 3:
            return []
        
        values = df['value'].values
        ma = np.mean(values[-3:])
        
        return [float(ma)] * periods


# Singleton instance
ml_service = MLService()
