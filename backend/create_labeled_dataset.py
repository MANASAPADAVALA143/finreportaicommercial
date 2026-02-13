import pandas as pd
from datetime import datetime
import numpy as np

def create_labeled_dataset(input_file, output_file):
    """
    Create labeled dataset with ground truth anomaly labels
    """
    
    print(f">> Reading {input_file}...")
    
    # Read file based on extension
    if input_file.lower().endswith('.csv'):
        df = pd.read_csv(input_file)
    else:
        df = pd.read_excel(input_file)
    
    print(f"[OK] Loaded {len(df)} entries")
    print(f"[INFO] Columns: {list(df.columns)}")
    
    # Normalize column names to handle case variations
    column_mapping = {}
    for col in df.columns:
        col_lower = col.lower()
        if 'entry' in col_lower and 'id' in col_lower:
            column_mapping[col] = 'Entry_ID'
        elif col_lower == 'id':
            column_mapping[col] = 'Entry_ID'
        elif 'date' in col_lower:
            column_mapping[col] = 'Date'
        elif 'time' in col_lower:
            column_mapping[col] = 'Time'
        elif 'debit' in col_lower:
            column_mapping[col] = 'Debit'
        elif 'credit' in col_lower:
            column_mapping[col] = 'Credit'
        elif 'description' in col_lower or 'desc' in col_lower:
            column_mapping[col] = 'Description'
        elif 'posted' in col_lower or 'preparer' in col_lower or 'prepared' in col_lower:
            column_mapping[col] = 'Posted_By'
        elif 'approved' in col_lower or 'approver' in col_lower:
            column_mapping[col] = 'Approved_By'
        elif 'account' in col_lower:
            column_mapping[col] = 'Account'
    
    df.rename(columns=column_mapping, inplace=True)
    print(f"[INFO] Normalized columns: {list(df.columns)}")
    
    # Initialize anomaly label column
    df['Is_Anomaly'] = 0
    df['Anomaly_Type'] = ''
    df['Anomaly_Reason'] = ''
    
    anomaly_count = 0
    
    print("\n[SCAN] Detecting anomalies...")
    
    for idx, row in df.iterrows():
        reasons = []
        anomaly_types = []
        
        # Rule 1: Both Debit and Credit filled (CRITICAL)
        if pd.notna(row.get('Debit')) and pd.notna(row.get('Credit')):
            if row['Debit'] > 0 and row['Credit'] > 0:
                df.at[idx, 'Is_Anomaly'] = 1
                anomaly_types.append('Control Violation')
                reasons.append('Both Debit & Credit filled')
                anomaly_count += 1
        
        # Rule 2: Both Debit and Credit are zero (CRITICAL)
        debit_val = row.get('Debit', 0) if pd.notna(row.get('Debit')) else 0
        credit_val = row.get('Credit', 0) if pd.notna(row.get('Credit')) else 0
        
        if debit_val == 0 and credit_val == 0:
            df.at[idx, 'Is_Anomaly'] = 1
            anomaly_types.append('Invalid Entry')
            reasons.append('Both Debit & Credit are zero')
            anomaly_count += 1
        
        # Rule 3: After-hours posting (22:00 - 06:00)
        if 'Time' in df.columns and pd.notna(row.get('Time')):
            try:
                if isinstance(row['Time'], str):
                    time_obj = datetime.strptime(row['Time'], '%H:%M:%S')
                else:
                    time_obj = row['Time']
                
                hour = time_obj.hour
                if hour >= 22 or hour <= 6:
                    df.at[idx, 'Is_Anomaly'] = 1
                    anomaly_types.append('Temporal Anomaly')
                    reasons.append(f'After-hours posting ({hour:02d}:xx)')
                    anomaly_count += 1
            except:
                pass
        
        # Rule 4: Large round amounts (250k, 500k, 1M)
        amount = max(debit_val, credit_val)
        suspicious_amounts = [250000, 500000, 1000000, 100000, 750000]
        if amount in suspicious_amounts:
            df.at[idx, 'Is_Anomaly'] = 1
            anomaly_types.append('Amount Anomaly')
            reasons.append(f'Suspicious round amount: ${amount:,.0f}')
            anomaly_count += 1
        
        # Rule 5: Very large amounts (> $200k)
        if amount > 200000:
            df.at[idx, 'Is_Anomaly'] = 1
            anomaly_types.append('Amount Anomaly')
            reasons.append(f'Unusually large amount: ${amount:,.0f}')
            anomaly_count += 1
        
        # Rule 6: Suspicious descriptions
        if 'Description' in df.columns and pd.notna(row.get('Description')):
            desc = str(row['Description']).lower()
            suspicious_keywords = ['adjustment', 'reversal', 'correction', 'manual', 'override']
            for keyword in suspicious_keywords:
                if keyword in desc:
                    df.at[idx, 'Is_Anomaly'] = 1
                    anomaly_types.append('Behavioral Anomaly')
                    reasons.append(f'Suspicious description: "{keyword}"')
                    anomaly_count += 1
                    break
        
        # Rule 7: Junior/Staff user with high amounts
        if 'Posted_By' in df.columns and pd.notna(row.get('Posted_By')):
            posted_by = str(row['Posted_By']).lower()
            if 'junior' in posted_by or 'staff' in posted_by or 'intern' in posted_by:
                if amount > 50000:
                    df.at[idx, 'Is_Anomaly'] = 1
                    anomaly_types.append('Behavioral Anomaly')
                    reasons.append(f'Junior user posting ${amount:,.0f}')
                    anomaly_count += 1
        
        # Rule 8: Same person as Posted By and Approved By
        if 'Posted_By' in df.columns and 'Approved_By' in df.columns:
            if pd.notna(row.get('Posted_By')) and pd.notna(row.get('Approved_By')):
                if str(row['Posted_By']).strip() == str(row['Approved_By']).strip():
                    df.at[idx, 'Is_Anomaly'] = 1
                    anomaly_types.append('SOD Violation')
                    reasons.append('Same person posted and approved')
                    anomaly_count += 1
        
        # Rule 9: Weekend posting
        if 'Date' in df.columns and pd.notna(row.get('Date')):
            try:
                if isinstance(row['Date'], str):
                    date_obj = pd.to_datetime(row['Date'])
                else:
                    date_obj = row['Date']
                
                if date_obj.dayofweek >= 5:  # Saturday=5, Sunday=6
                    df.at[idx, 'Is_Anomaly'] = 1
                    anomaly_types.append('Temporal Anomaly')
                    day_name = date_obj.strftime('%A')
                    reasons.append(f'Weekend posting ({day_name})')
                    anomaly_count += 1
            except:
                pass
        
        # Store anomaly information
        if df.at[idx, 'Is_Anomaly'] == 1:
            df.at[idx, 'Anomaly_Type'] = '; '.join(set(anomaly_types))
            df.at[idx, 'Anomaly_Reason'] = ' | '.join(reasons[:3])  # Limit to 3 reasons
    
    # Summary statistics
    print(f"\n[SUMMARY]")
    print(f"   Total Entries: {len(df)}")
    print(f"   Normal Entries: {len(df[df['Is_Anomaly'] == 0])}")
    print(f"   Anomalies Detected: {df['Is_Anomaly'].sum()}")
    print(f"   Anomaly Rate: {df['Is_Anomaly'].sum() / len(df) * 100:.1f}%")
    
    # Anomaly type breakdown
    if df['Is_Anomaly'].sum() > 0:
        print(f"\n[BREAKDOWN] Anomaly Types:")
        anomaly_df = df[df['Is_Anomaly'] == 1]
        for anomaly_type in anomaly_df['Anomaly_Type'].unique():
            if anomaly_type:
                count = len(anomaly_df[anomaly_df['Anomaly_Type'].str.contains(anomaly_type, na=False)])
                print(f"   {anomaly_type}: {count}")
    
    # Save labeled dataset
    print(f"\n[SAVE] Saving to {output_file}...")
    
    # Save based on extension
    if output_file.lower().endswith('.csv'):
        df.to_csv(output_file, index=False)
    else:
        df.to_excel(output_file, index=False)
    
    print(f"[OK] COMPLETE! Labeled dataset saved.")
    
    return df

# Run the script
if __name__ == "__main__":
    import sys
    import os
    
    # Check for command line argument
    if len(sys.argv) > 1:
        input_file = sys.argv[1]
    else:
        # Try common locations
        possible_paths = [
            "/mnt/user-data/uploads/R2R_500_Transactions_With_Anomalies.xlsx",
            "R2R_500_Transactions_With_Anomalies.xlsx",
            "../R2R_500_Transactions_With_Anomalies.xlsx",
            "./sample_journal_entries.csv"
        ]
        
        input_file = None
        for path in possible_paths:
            if os.path.exists(path):
                input_file = path
                break
        
        if not input_file:
            print("[ERROR] No input file found!")
            print("\nUsage: python create_labeled_dataset.py [input_file]")
            print("\nOr place one of these files in the current directory:")
            print("  - R2R_500_Transactions_With_Anomalies.xlsx")
            print("  - sample_journal_entries.csv")
            sys.exit(1)
    
    # Determine output filename
    base_name = os.path.splitext(os.path.basename(input_file))[0]
    ext = os.path.splitext(input_file)[1]
    output_file = f"{base_name}_LABELED{ext}"
    
    print(f">> Input file: {input_file}")
    print(f">> Output file: {output_file}\n")
    
    df = create_labeled_dataset(input_file, output_file)
    
    # Show sample anomalies
    if df['Is_Anomaly'].sum() > 0:
        print("\n[SAMPLES] Top 10 Anomalies:")
        anomalies = df[df['Is_Anomaly'] == 1].head(10)
        # Display columns that exist
        display_cols = []
        
        # Check for ID column variations
        for id_col in ['Entry_ID', 'id', 'ID', 'entry_id']:
            if id_col in anomalies.columns:
                display_cols.append(id_col)
                break
        
        # Add other columns if they exist
        for col in ['Debit', 'debit', 'Credit', 'credit', 'Description', 'description']:
            if col in anomalies.columns and col not in display_cols:
                display_cols.append(col)
        
        # Add anomaly columns
        display_cols.extend(['Anomaly_Type', 'Anomaly_Reason'])
        
        # Filter only existing columns
        available_cols = [col for col in display_cols if col in anomalies.columns]
        if available_cols:
            print(anomalies[available_cols].to_string())
    else:
        print("\n[WARNING] No anomalies detected in the dataset!")
