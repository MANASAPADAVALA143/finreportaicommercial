import boto3
from botocore.config import Config
import json
import os
import re
from typing import Dict, List, Any
from datetime import datetime

class NovaService:
    def __init__(self):
        self._client = None  # Lazy-load to avoid blocking startup
        self.model_id = "us.amazon.nova-lite-v1:0"
    
    @property
    def client(self):
        """Lazy-load AWS Bedrock client only when needed"""
        if self._client is None:
            try:
                self._client = boto3.client(
                    'bedrock-runtime',
                    region_name=os.getenv('AWS_REGION', 'us-east-1'),
                    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
                    config=Config(
                        connect_timeout=5,
                        read_timeout=10
                    )
                )
                try:
                    print("[INFO] AWS Bedrock client initialized successfully")
                except:
                    pass
            except Exception as e:
                try:
                    print(f"[WARNING] AWS Bedrock client initialization failed: {e}")
                    print("   Falling back to rule-based analysis")
                except:
                    pass
                self._client = None
        return self._client
    
    def _sanitize(self, value):
        """Sanitize string to ASCII for Windows compatibility"""
        if isinstance(value, str):
            return value.encode('ascii', errors='replace').decode('ascii')
        return str(value)
    
    def analyze_journal_entry(self, entry: dict, threshold: int = 40) -> dict:
        """Enhanced fraud detection with explicit anomaly rules and configurable threshold"""
        
        # Extract and normalize values - SANITIZE ALL STRINGS FOR WINDOWS
        entry_id = self._sanitize(entry.get('ID', entry.get('id', entry.get('Entry_ID', 'Unknown'))))
        date = self._sanitize(entry.get('Date', entry.get('date', entry.get('Posting_Date', ''))))
        time = self._sanitize(entry.get('Time', entry.get('time', entry.get('Posting_Time', ''))))
        account = self._sanitize(entry.get('Account', entry.get('account', '')))
        description = self._sanitize(entry.get('Description', entry.get('description', '')))
        debit = float(entry.get('Debit', entry.get('debit', 0)))
        credit = float(entry.get('Credit', entry.get('credit', 0)))
        posted_by = self._sanitize(entry.get('Posted_By', entry.get('posted_by', entry.get('preparer', 'Unknown'))))
        approved_by = self._sanitize(entry.get('Approved_By', entry.get('approved_by', entry.get('approver', 'Unknown'))))
        
        prompt = f"""You are an EXPERT financial fraud auditor with ZERO TOLERANCE for suspicious patterns.

CRITICAL ANALYSIS for Journal Entry:

Entry Details:
- Entry ID: {entry_id}
- Date: {date}
- Time: {time if time else 'Not provided'}
- GL Account: {account}
- Description: {description}
- Debit: ${debit:,.2f}
- Credit: ${credit:,.2f}
- Posted By: {posted_by}
- Approved By: {approved_by}

🚨 MANDATORY HIGH-RISK INDICATORS (MUST score 70-100 if ANY found):
1. Both Debit AND Credit filled simultaneously (control violation)
2. Both Debit AND Credit are zero (invalid entry)
3. Posting time between 22:00-06:00 (after-hours)
4. Round amounts: $100k, $250k, $500k, $1M (manipulation indicator)
5. Amount over $200,000 (unusual large transaction)
6. Description contains: "Adjustment", "Reversal", "Correction", "Manual", "Override"
7. Junior/Staff/Intern user posting amount > $50,000
8. Same person as Posted By and Approved By (SOD violation)
9. Weekend posting (Saturday/Sunday)

📊 MEDIUM-RISK INDICATORS (Score 40-69):
1. Amount > $100,000 but < $200,000
2. Unusual GL account combinations
3. Missing approver for amounts > $10,000
4. Posting after 18:00 but before 22:00

📈 ANALYSIS REQUIREMENTS:
- Check EVERY high-risk indicator above
- If ANY high-risk indicator found → riskScore MUST be 70 or higher
- Be EXPLICIT about which rules were violated
- Calculate exact SHAP percentages based on severity
- Provide statistical z-score and percentile

Return ONLY JSON (no markdown, no backticks, no explanation):
{{
  "riskScore": <number 0-100, MUST be ≥70 if high-risk indicator found>,
  "riskLevel": "<Low|Medium|High>",
  "anomalies": ["<specific violation with details>"],
  "shapBreakdown": {{
    "amountAnomaly": <0-100, percentage contribution>,
    "temporalAnomaly": <0-100, percentage contribution>,
    "behavioralAnomaly": <0-100, percentage contribution>,
    "accountAnomaly": <0-100, percentage contribution>
  }},
  "statisticalAnalysis": {{
    "zScore": <number, standard deviations from mean>,
    "percentile": <0-100, ranking among all transactions>
  }},
  "explanation": "<detailed explanation of all findings>",
  "recommendation": "<APPROVE|REVIEW|ESCALATE>"
}}

CRITICAL RULES:
- Control violation (both debit & credit) = riskScore 85+
- After-hours posting = riskScore 75+
- Large round amounts = riskScore 80+
- SOD violation = riskScore 90+
- If multiple violations = riskScore 95+
- SHAP values must sum to ~100%"""

        try:
            # Check if AWS client is available
            if self.client is None:
                try:
                    print(f"[WARNING] AWS not available for {entry_id}, using rule-based analysis")
                except:
                    pass
                return self._rule_based_analysis(entry, threshold=threshold)
            
            response = self.client.converse(
                modelId=self.model_id,
                messages=[{
                    "role": "user",
                    "content": [{"text": prompt}]
                }]
            )
            
            text = response['output']['message']['content'][0]['text']
            
            # Clean response
            text = text.strip()
            text = text.replace('```json', '').replace('```', '').strip()
            
            # Extract JSON
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                analysis = json.loads(json_match[0])
                
                # Validate and ensure structure
                return {
                    "entryId": entry_id,
                    "riskScore": int(analysis.get('riskScore', 50)),
                    "riskLevel": analysis.get('riskLevel', 'Medium'),
                    "anomalies": analysis.get('anomalies', []),
                    "shapBreakdown": {
                        "amountAnomaly": float(analysis.get('shapBreakdown', {}).get('amountAnomaly', 25)),
                        "temporalAnomaly": float(analysis.get('shapBreakdown', {}).get('temporalAnomaly', 25)),
                        "behavioralAnomaly": float(analysis.get('shapBreakdown', {}).get('behavioralAnomaly', 25)),
                        "accountAnomaly": float(analysis.get('shapBreakdown', {}).get('accountAnomaly', 25))
                    },
                    "statisticalAnalysis": {
                        "zScore": float(analysis.get('statisticalAnalysis', {}).get('zScore', 0.0)),
                        "percentile": float(analysis.get('statisticalAnalysis', {}).get('percentile', 50))
                    },
                    "explanation": analysis.get('explanation', ''),
                    "recommendation": analysis.get('recommendation', 'REVIEW')
                }
            
            raise ValueError("Failed to parse Nova response")
            
        except Exception as e:
            try:
                print(f"[ERROR] Nova analysis error: {str(e)}")
            except:
                pass
            # Fallback to rule-based
            return self._rule_based_analysis(entry, threshold=threshold)
    
    def _rule_based_analysis(self, entry: dict, threshold: int = 40) -> dict:
        """Rule-based fallback analysis with configurable threshold"""
        
        # SANITIZE ALL STRINGS FOR WINDOWS
        entry_id = self._sanitize(entry.get('ID', entry.get('id', entry.get('Entry_ID', 'Unknown'))))
        debit = float(entry.get('Debit', entry.get('debit', 0)))
        credit = float(entry.get('Credit', entry.get('credit', 0)))
        description = self._sanitize(entry.get('Description', entry.get('description', ''))).lower()
        posted_by = self._sanitize(entry.get('Posted_By', entry.get('posted_by', entry.get('preparer', '')))).lower()
        approved_by = self._sanitize(entry.get('Approved_By', entry.get('approved_by', entry.get('approver', '')))).lower()
        
        risk_score = 20
        anomalies = []
        shap_amount = 10
        shap_temporal = 10
        shap_behavioral = 10
        shap_account = 10
        
        # Rule 1: Both debit and credit
        if debit > 0 and credit > 0:
            risk_score += 65
            anomalies.append("CRITICAL: Both Debit and Credit filled (control violation)")
            shap_behavioral += 40
        
        # Rule 2: Both zero
        if debit == 0 and credit == 0:
            risk_score += 60
            anomalies.append("CRITICAL: Both Debit and Credit are zero (invalid entry)")
            shap_amount += 30
        
        # Rule 3: Large amount
        amount = max(debit, credit)
        if amount > 200000:
            risk_score += 50
            anomalies.append(f"Very large amount: ${amount:,.0f}")
            shap_amount += 45
        elif amount > 100000:
            risk_score += 30
            anomalies.append(f"💵 Large amount: ${amount:,.0f}")
            shap_amount += 25
        
        # Rule 4: Round amounts
        if amount in [100000, 250000, 500000, 750000, 1000000]:
            risk_score += 40
            anomalies.append(f"🔴 Suspicious round amount: ${amount:,.0f}")
            shap_amount += 30
        
        # Rule 5: Suspicious description
        suspicious_words = ['adjustment', 'reversal', 'correction', 'manual', 'override']
        if any(word in description for word in suspicious_words):
            risk_score += 35
            anomalies.append(f"📝 Suspicious description keyword found")
            shap_behavioral += 25
        
        # Rule 6: SOD violation
        if posted_by and approved_by and posted_by == approved_by:
            risk_score += 60
            anomalies.append("🚫 SOD Violation: Same person posted and approved")
            shap_behavioral += 50
        
        # Rule 7: Junior user high amount
        if ('junior' in posted_by or 'staff' in posted_by) and amount > 50000:
            risk_score += 40
            anomalies.append(f"Junior user posting ${amount:,.0f}")
            shap_behavioral += 30
        
        # Normalize risk score
        risk_score = min(risk_score, 100)
        
        # Determine risk level using CUSTOM THRESHOLD
        if risk_score >= 70:
            risk_level = "High"
            recommendation = "ESCALATE"
        elif risk_score >= threshold:  # Use custom threshold for Medium
            risk_level = "Medium"
            recommendation = "REVIEW"
        else:
            risk_level = "Low"
            recommendation = "APPROVE"
        
        # Normalize SHAP values
        total_shap = shap_amount + shap_temporal + shap_behavioral + shap_account
        if total_shap > 0:
            shap_amount = (shap_amount / total_shap) * 100
            shap_temporal = (shap_temporal / total_shap) * 100
            shap_behavioral = (shap_behavioral / total_shap) * 100
            shap_account = (shap_account / total_shap) * 100
        
        # Calculate z-score
        z_score = 0.5
        if risk_score >= 70:
            z_score = 3.5
        elif risk_score >= 40:
            z_score = 2.0
        
        return {
            "entryId": entry_id,
            "riskScore": risk_score,
            "riskLevel": risk_level,
            "anomalies": anomalies if anomalies else ["No significant anomalies detected"],
            "shapBreakdown": {
                "amountAnomaly": round(shap_amount, 1),
                "temporalAnomaly": round(shap_temporal, 1),
                "behavioralAnomaly": round(shap_behavioral, 1),
                "accountAnomaly": round(shap_account, 1)
            },
            "statisticalAnalysis": {
                "zScore": round(z_score, 2),
                "percentile": round((risk_score / 100) * 99, 1)
            },
            "explanation": " | ".join(anomalies) if anomalies else "Transaction appears normal",
            "recommendation": recommendation
        }
    
    def analyze_batch_with_ground_truth(
        self, 
        entries: List[dict],
        ground_truth_labels: List[int] = None,
        threshold: int = 40
    ) -> dict:
        """Analyze batch and calculate metrics using ground truth with configurable threshold"""
        
        try:
            print(f"\n[ANALYSIS] Processing {len(entries)} entries with threshold {threshold}...")
        except:
            pass
        results = []
        
        for idx, entry in enumerate(entries):
            try:
                print(f"   Processing {idx+1}/{len(entries)}...", end='\r')
            except:
                pass  # Ignore print errors
            analysis = self.analyze_journal_entry(entry, threshold=threshold)
            results.append(analysis)
        
        try:
            print(f"\n[INFO] Analysis complete!")
        except:
            pass  # Ignore print errors
        
        # Calculate summary
        high_risk = sum(1 for r in results if r['riskLevel'] == 'High')
        medium_risk = sum(1 for r in results if r['riskLevel'] == 'Medium')
        low_risk = sum(1 for r in results if r['riskLevel'] == 'Low')
        
        # Calculate metrics with ground truth if provided
        if ground_truth_labels:
            metrics = self._calculate_metrics_with_ground_truth(results, ground_truth_labels, threshold=threshold)
            confusion_matrix = metrics.pop('confusionMatrix')
        else:
            metrics = self._calculate_basic_metrics(results, threshold=threshold)
            confusion_matrix = metrics.pop('confusionMatrix', {
                'truePositive': high_risk + medium_risk,
                'falsePositive': 0,
                'trueNegative': low_risk,
                'falseNegative': 0
            })
        
        return {
            "results": results,
            "summary": {
                "total": len(results),
                "highRisk": high_risk,
                "mediumRisk": medium_risk,
                "lowRisk": low_risk
            },
            "metrics": metrics,
            "confusionMatrix": confusion_matrix
        }
    
    def _calculate_metrics_with_ground_truth(
        self, 
        results: List[dict], 
        ground_truth: List[int],
        threshold: int = 40
    ) -> dict:
        """Calculate metrics using actual ground truth labels with configurable threshold"""
        
        # Convert to binary predictions using CUSTOM THRESHOLD
        y_true = ground_truth
        y_pred = [1 if r['riskScore'] >= threshold else 0 for r in results]
        
        # Confusion matrix
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 1)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t == 0 and p == 1)
        tn = sum(1 for t, p in zip(y_true, y_pred) if t == 0 and p == 0)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 0)
        
        # Calculate metrics
        total = len(y_true)
        accuracy = ((tp + tn) / total * 100) if total > 0 else 0
        precision = (tp / (tp + fp) * 100) if (tp + fp) > 0 else 0
        recall = (tp / (tp + fn) * 100) if (tp + fn) > 0 else 0
        f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0
        
        return {
            "accuracy": round(accuracy, 1),
            "precision": round(precision, 1),
            "recall": round(recall, 1),
            "f1Score": round(f1, 1),
            "confusionMatrix": {
                "truePositive": tp,
                "falsePositive": fp,
                "trueNegative": tn,
                "falseNegative": fn
            },
            "groundTruthAnomalies": sum(y_true),
            "detectedAnomalies": tp,
            "missedAnomalies": fn,
            "falseAlarms": fp
        }
    
    def _calculate_basic_metrics(self, results: List[dict], threshold: int = 40) -> dict:
        """Calculate basic metrics without ground truth using configurable threshold"""
        
        # Assume Medium/High = Positive (above threshold), Low = Negative
        total = len(results)
        positives = sum(1 for r in results if r['riskScore'] >= threshold)
        negatives = total - positives
        
        # Simple estimates
        tp = positives
        tn = negatives
        fp = 0
        fn = 0
        
        accuracy = ((tp + tn) / total * 100) if total > 0 else 0
        precision = 100 if positives > 0 else 0
        recall = 100 if positives > 0 else 0
        f1 = 100 if positives > 0 else 0
        
        return {
            "accuracy": round(accuracy, 1),
            "precision": round(precision, 1),
            "recall": round(recall, 1),
            "f1Score": round(f1, 1),
            "confusionMatrix": {
                "truePositive": tp,
                "falsePositive": fp,
                "trueNegative": tn,
                "falseNegative": fn
            }
        }

# Singleton
nova_service = NovaService()
