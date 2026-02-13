"""
Generate sample journal entry data with realistic anomalies for testing
"""
import pandas as pd
import random
from datetime import datetime, timedelta

def generate_sample_data(num_entries=500):
    """Generate sample journal entries with controlled anomalies"""
    
    print(f"🔧 Generating {num_entries} sample journal entries...")
    
    entries = []
    entry_id = 1000
    
    # Sample data pools
    accounts = [
        '100-Cash', '200-AR', '300-Inventory', '400-Equipment',
        '500-AP', '600-Revenue', '700-COGS', '800-Expenses',
        '900-Payroll', '950-Utilities'
    ]
    
    descriptions = [
        'Monthly accrual', 'Vendor payment', 'Customer receipt',
        'Depreciation expense', 'Payroll processing', 'Utility payment',
        'Revenue recognition', 'Inventory purchase', 'Office supplies',
        'Equipment maintenance', 'Bank fee', 'Interest income'
    ]
    
    users = [
        'John Smith', 'Jane Doe', 'Robert Johnson', 'Sarah Williams',
        'Michael Brown', 'Emily Davis', 'David Miller', 'Jessica Wilson',
        'Staff Accountant', 'Junior Accountant', 'Senior Accountant'
    ]
    
    approvers = [
        'CFO Manager', 'Finance Director', 'Controller',
        'Accounting Manager', 'VP Finance'
    ]
    
    # Start date
    start_date = datetime(2024, 1, 1)
    
    # Generate entries
    for i in range(num_entries):
        # Random date within the year
        days_offset = random.randint(0, 365)
        entry_date = start_date + timedelta(days=days_offset)
        
        # Random time (mostly business hours, some after hours)
        if random.random() < 0.92:  # 92% business hours
            hour = random.randint(8, 18)
        else:  # 8% after hours (anomaly)
            hour = random.choice([22, 23, 0, 1, 2, 3, 4, 5, 6])
        
        minute = random.randint(0, 59)
        posting_time = f"{hour:02d}:{minute:02d}:00"
        
        # Generate amount (mostly normal, some large/round)
        if random.random() < 0.90:  # 90% normal amounts
            amount = round(random.uniform(100, 50000), 2)
        else:  # 10% suspicious amounts
            amount = random.choice([100000, 250000, 500000, 750000, 1000000])
        
        # Decide if debit or credit (mostly one, rarely both)
        debit = 0
        credit = 0
        
        if random.random() < 0.02:  # 2% control violation (both filled)
            debit = amount
            credit = amount
        elif random.random() < 0.50:  # 50% debit
            debit = amount
        else:  # 48% credit
            credit = amount
        
        # Preparer and approver
        preparer = random.choice(users)
        
        # Most have different approvers (good), some same (SOD violation)
        if random.random() < 0.95:  # 95% good SOD
            approver = random.choice(approvers)
        else:  # 5% SOD violation
            approver = preparer
        
        # Description (mostly normal, some suspicious keywords)
        if random.random() < 0.90:  # 90% normal
            description = random.choice(descriptions)
        else:  # 10% suspicious
            description = random.choice([
                'Manual adjustment entry',
                'Correction - reversal',
                'Override - approved by CFO',
                'Adjustment - end of month',
                'Manual correction required'
            ])
        
        # Create entry
        entry = {
            'ID': entry_id,
            'Posting_Date': entry_date.strftime('%Y-%m-%d'),
            'Posting_Time': posting_time,
            'Account': random.choice(accounts),
            'Description': description,
            'Debit': debit if debit > 0 else '',
            'Credit': credit if credit > 0 else '',
            'Posted_By': preparer,
            'Approved_By': approver
        }
        
        entries.append(entry)
        entry_id += 1
    
    # Create DataFrame
    df = pd.DataFrame(entries)
    
    # Add a few entries with both debit/credit zero (invalid entries)
    for _ in range(3):
        idx = random.randint(0, len(df) - 1)
        df.at[idx, 'Debit'] = ''
        df.at[idx, 'Credit'] = ''
    
    print(f"✅ Generated {len(df)} entries")
    
    # Statistics
    both_filled = sum((df['Debit'] != '') & (df['Credit'] != ''))
    both_empty = sum((df['Debit'] == '') & (df['Credit'] == ''))
    large_amounts = sum((df['Debit'].apply(lambda x: x >= 100000 if x != '' else False)) | 
                        (df['Credit'].apply(lambda x: x >= 100000 if x != '' else False)))
    weekend_entries = sum(pd.to_datetime(df['Posting_Date']).dt.dayofweek >= 5)
    
    print(f"\n📊 ANOMALY PREVIEW:")
    print(f"   Both Debit & Credit filled: {both_filled}")
    print(f"   Both Debit & Credit empty: {both_empty}")
    print(f"   Large amounts (≥$100k): {large_amounts}")
    print(f"   Weekend postings: {weekend_entries}")
    
    return df

if __name__ == "__main__":
    # Generate sample data
    df = generate_sample_data(500)
    
    # Save to Excel
    output_file = "R2R_500_Transactions_Debit_Credit_With_Anomalies.xlsx"
    print(f"\n💾 Saving to {output_file}...")
    df.to_excel(output_file, index=False)
    
    print(f"✅ COMPLETE! File saved: {output_file}")
    print(f"\n🎯 NEXT STEP:")
    print(f"   python create_labeled_dataset.py {output_file}")
