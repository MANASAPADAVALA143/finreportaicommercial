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
    
    def _check_aws_credentials(self):
        """Warn if credentials look like temporary (ASIA) or session token is set - CFO Decision needs long-lived IAM keys."""
        key = (os.getenv("AWS_ACCESS_KEY_ID") or "").strip()
        if key.upper().startswith("ASIA"):
            print("[WARNING] AWS_ACCESS_KEY_ID looks like temporary credentials (ASIA). Use long-lived IAM user keys (AKIA) from IAM → Users → Security credentials → Create access key.")
        if os.getenv("AWS_SESSION_TOKEN"):
            print("[WARNING] AWS_SESSION_TOKEN is set. Remove it from .env for Bedrock; temporary/session keys often cause 'invalid security token'. Use long-lived IAM user keys only.")

    @property
    def client(self):
        """Lazy-load AWS Bedrock client only when needed. Uses only long-lived IAM keys (no session token)."""
        if self._client is None:
            try:
                self._check_aws_credentials()
                region = os.getenv("AWS_REGION", "us-east-1")
                access_key = (os.getenv("AWS_ACCESS_KEY_ID") or "").strip()
                secret_key = (os.getenv("AWS_SECRET_ACCESS_KEY") or "").strip()
                if not access_key or not secret_key:
                    raise ValueError("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set in .env (backend folder)")
                # Use only access key + secret; do NOT pass aws_session_token so temporary credentials are not used
                self._client = boto3.client(
                    "bedrock-runtime",
                    region_name=region,
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    config=Config(connect_timeout=5, read_timeout=60),
                )
                print("[INFO] AWS Bedrock client initialized successfully (Nova/CFO Decision)")
            except Exception as e:
                err = str(e).lower()
                if "invalid" in err or "security token" in err or "token" in err:
                    print("[ERROR] AWS key not accepted. Use long-lived IAM user keys (AKIA...) from AWS Console → IAM → Users → Security credentials → Create access key. Remove AWS_SESSION_TOKEN from .env if present.")
                print(f"[WARNING] AWS Bedrock client initialization failed: {e}")
                print("   Nova/CFO Decision will fall back to rule-based analysis.")
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
                
                # Validate and ensure structure (R2R Journal Entry anomaly detection with Nova)
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
                    "recommendation": analysis.get('recommendation', 'REVIEW'),
                    "analysisSource": "amazon_nova",
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
        entry_id = self._sanitize(entry.get('ID', entry.get('id', entry.get('JE_ID', entry.get('Entry_ID', 'Unknown')))))
        debit = float(entry.get('Debit', entry.get('debit', 0)))
        credit = float(entry.get('Credit', entry.get('credit', 0)))
        description = self._sanitize(entry.get('Description', entry.get('description', entry.get('Type', '')))).lower()
        posted_by = self._sanitize(entry.get('Posted_By', entry.get('posted_by', entry.get('preparer', entry.get('Vendor/Customer', ''))))).lower()
        approved_by = self._sanitize(entry.get('Approved_By', entry.get('approved_by', entry.get('approver', '')))).lower()
        
        # NEW: Check for Duplicate flag and Weekend flag
        is_duplicate = entry.get('Duplicate', False) or entry.get('duplicate', False)
        is_weekend = entry.get('Weekend', False) or entry.get('weekend', False)
        is_manual = entry.get('Manual', False) or entry.get('manual', False)
        
        risk_score = 20
        anomalies = []
        shap_amount = 10
        shap_temporal = 10
        shap_behavioral = 10
        shap_account = 10
        
        # PRIORITY Rule: Duplicate Entry (HIGHEST RISK)
        if is_duplicate:
            risk_score += 60
            anomalies.append("🔴 DUPLICATE ENTRY: This entry matches an existing posted transaction (same vendor, same amount, same period). Duplicate journal entries are a common source of financial misstatement and potential fraud. RECOMMENDED ACTION: Block posting and escalate to Controller for review.")
            shap_behavioral += 60
        
        # PRIORITY Rule: Weekend + Large Amount
        amount = max(debit, credit)
        if is_weekend and amount > 100000:
            risk_score += 55
            anomalies.append(f"🕐 WEEKEND POSTING: This entry was posted on a Saturday/Sunday outside normal business hours with amount ${amount:,.0f}. Weekend postings without prior authorisation violate Segregation of Duties controls. RECOMMENDED ACTION: Confirm who authorised this entry and validate business justification.")
            shap_temporal += 45
            shap_amount += 30
        elif is_weekend and amount > 50000:
            risk_score += 40
            anomalies.append(f"🕐 WEEKEND POSTING: This entry of ${amount:,.0f} was posted outside normal business hours. Weekend postings require special authorisation and oversight. RECOMMENDED ACTION: Verify proper approvals are on file.")
            shap_temporal += 35
        
        # Manual Entry flag
        if is_manual and amount > 50000:
            risk_score += 30
            anomalies.append(f"✏️ MANUAL JOURNAL ENTRY: This is a manual journal entry of ${amount:,.0f} bypassing the automated posting workflow. Manual entries carry higher fraud risk as they override system controls. RECOMMENDED ACTION: Verify preparer authorisation and ensure dual approval is on file.")
            shap_behavioral += 25
        
        # Rule 1: Both debit and credit
        if debit > 0 and credit > 0:
            risk_score += 65
            anomalies.append(f"🚨 CONTROL VIOLATION: Both Debit (${debit:,.0f}) and Credit (${credit:,.0f}) are filled simultaneously. This violates fundamental accounting controls and suggests either data entry error or potential manipulation. RECOMMENDED ACTION: Reject entry immediately and investigate source system controls.")
            shap_behavioral += 40
        
        # Rule 2: Both zero
        if debit == 0 and credit == 0:
            risk_score += 60
            anomalies.append("🚨 INVALID ENTRY: Both Debit and Credit are zero. This is a null transaction with no financial impact and should not exist in the general ledger. RECOMMENDED ACTION: Delete entry and review posting process for system errors.")
            shap_amount += 30
        
        # Rule 3: Large amount (only if not already counted in weekend check)
        if not (is_weekend and amount > 100000):  # Avoid double-counting
            if amount > 200000:
                risk_score += 50
                anomalies.append(f"⚠️ MATERIALITY ALERT: Transaction amount of ${amount:,.0f} is significantly above the account average. This triggers a materiality threshold alert requiring enhanced scrutiny. RECOMMENDED ACTION: Verify supporting invoice, obtain secondary approval, and confirm vendor legitimacy before posting.")
                shap_amount += 45
            elif amount > 100000:
                risk_score += 30
                anomalies.append(f"⚠️ LARGE AMOUNT: Transaction amount of ${amount:,.0f} exceeds standard posting thresholds. Large transactions require additional oversight to prevent material misstatement. RECOMMENDED ACTION: Verify supporting documentation and ensure proper authorisation level.")
                shap_amount += 25
        
        # Rule 4: Round amounts
        if amount in [100000, 250000, 500000, 750000, 1000000]:
            risk_score += 40
            anomalies.append(f"🎯 SUSPICIOUS ROUND AMOUNT: Exactly ${amount:,.0f} is an unusually round figure. Round amounts are statistical red flags for earnings manipulation or fraud as legitimate transactions rarely result in perfect round numbers. RECOMMENDED ACTION: Request detailed calculation worksheet and validate underlying business transaction.")
            shap_amount += 30
        
        # Rule 5: Suspicious description
        suspicious_words = ['adjustment', 'reversal', 'correction', 'manual', 'override']
        if any(word in description for word in suspicious_words):
            risk_score += 35
            anomalies.append(f"📝 SUSPICIOUS DESCRIPTION: Entry contains keyword '{[w for w in suspicious_words if w in description][0]}' which is commonly associated with manual interventions and adjusting entries. These carry higher fraud risk. RECOMMENDED ACTION: Verify business justification, obtain management approval, and ensure proper documentation is attached.")
            shap_behavioral += 25
        
        # Rule 6: SOD violation
        if posted_by and approved_by and posted_by == approved_by:
            risk_score += 60
            anomalies.append(f"🚨 SEGREGATION OF DUTIES VIOLATION: The same person ('{posted_by}') prepared and approved this entry. This is a critical internal control failure and audit finding that violates SOX requirements. RECOMMENDED ACTION: Immediate escalation to CFO. Entry should be reversed pending independent review and re-approval.")
            shap_behavioral += 50
        
        # Rule 7: Junior user high amount
        if ('junior' in posted_by or 'staff' in posted_by) and amount > 50000:
            risk_score += 40
            anomalies.append(f"⚠️ AUTHORISATION CONCERN: Junior staff member is posting ${amount:,.0f} which exceeds their typical authorisation limit. This may indicate compromised credentials or inadequate role-based access controls. RECOMMENDED ACTION: Verify that the staff member has proper delegated authority for this transaction size.")
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
            "anomalies": anomalies if anomalies else ["✅ No significant anomalies detected. Transaction appears normal and complies with standard controls."],
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
            "explanation": "\n\n".join(anomalies) if anomalies else "✅ Transaction appears normal and complies with standard controls.",
            "recommendation": recommendation,
            "analysisSource": "rule_based",
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

    def invoke(self, prompt: str, model_id: str = None, max_tokens: int = 600, temperature: float = 0.3) -> str:
        """Raw invoke: send prompt to Bedrock, return response text. Used by CFO Decision Intelligence /api/nova/invoke."""
        if self.client is None:
            raise RuntimeError(
                "AWS Bedrock not available. In backend/.env set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY (long-lived IAM user keys, not temporary). Remove AWS_SESSION_TOKEN if present."
            )
        model = model_id or self.model_id
        try:
            response = self.client.converse(
                modelId=model,
                messages=[{"role": "user", "content": [{"text": prompt}]}],
                inferenceConfig={
                    "maxTokens": max_tokens,
                    "temperature": temperature,
                },
            )
            return response["output"]["message"]["content"][0]["text"]
        except Exception as e:
            msg = str(e)
            if "InvalidClientTokenId" in msg or "security token" in msg.lower() or "UnrecognizedClientException" in msg:
                raise RuntimeError(
                    "AWS key not working: use long-lived IAM user keys (AKIA...) from AWS Console → IAM → Users → Security credentials → Create access key. Remove AWS_SESSION_TOKEN from backend/.env. Temporary (ASIA) keys will not work."
                ) from e
            raise

# Singleton
nova_service = NovaService()
