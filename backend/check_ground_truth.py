import pandas as pd
import sys

# Force UTF-8 encoding
sys.stdout.reconfigure(encoding='utf-8')

print("\n" + "="*50)
print("   CHECKING GROUND TRUTH LABELS")
print("="*50 + "\n")

try:
    # Load the file
    df = pd.read_excel('R2R_500_Transactions_Labeled_With_Anomalies_Test_Set_2.xlsx')
    
    print(f"[OK] File loaded successfully!")
    print(f"   Total rows: {len(df)}")
    print(f"\n[INFO] Columns found:")
    for col in df.columns:
        print(f"   - {col}")
    
    # Check for Is_Anomaly column
    if 'Is_Anomaly' in df.columns:
        print(f"\n[SUCCESS] Ground truth column 'Is_Anomaly' EXISTS!")
        print(f"   True anomalies labeled: {df['Is_Anomaly'].sum()}")
        print(f"   Normal entries: {(df['Is_Anomaly'] == 0).sum()}")
        print(f"   Anomaly rate: {(df['Is_Anomaly'].sum() / len(df) * 100):.1f}%")
        
        # Show sample anomalies
        print(f"\n[SAMPLE] First 5 labeled anomalies:")
        anomalies = df[df['Is_Anomaly'] == 1].head()
        for idx, row in anomalies.iterrows():
            entry_id = row.get('Entry_ID', row.get('ID', 'Unknown'))
            debit = row.get('Debit', 0)
            credit = row.get('Credit', 0)
            desc = str(row.get('Description', ''))[:40]
            print(f"   #{idx+1}: {entry_id} | Debit: ${debit:,.0f} | Credit: ${credit:,.0f} | {desc}...")
    else:
        print(f"\n[WARNING] No 'Is_Anomaly' column found!")
        print(f"   Metrics will be ESTIMATED (not accurate)")
        print(f"\n   To get real metrics, you need to:")
        print(f"   1. Add 'Is_Anomaly' column to Excel")
        print(f"   2. Set 1 for anomalies, 0 for normal")
        print(f"   3. Re-upload the file")
    
    print("\n" + "="*50 + "\n")

except FileNotFoundError:
    print(f"\n[ERROR] File not found!")
    print(f"   Looking for: R2R_500_Transactions_Labeled_With_Anomalies_Test_Set_2.xlsx")
    print(f"   In directory: {os.getcwd()}")

except Exception as e:
    print(f"\n[ERROR] {str(e)}")
