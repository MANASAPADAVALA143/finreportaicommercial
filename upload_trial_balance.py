"""
Simple script to upload Trial Balance to CFO Dashboard
"""

import requests

def upload_trial_balance(file_path):
    """Upload your Trial Balance Excel/CSV file"""
    
    url = "http://localhost:8000/api/cfo/upload/trial-balance"
    
    # Open and upload the file
    with open(file_path, 'rb') as f:
        files = {'file': f}
        response = requests.post(url, files=files)
    
    if response.status_code == 200:
        result = response.json()
        print("✅ SUCCESS!")
        print(f"Message: {result['message']}")
        print(f"\nYour Dashboard Data:")
        print(f"  Cash: ${result['data']['cash']['current']:,}")
        print(f"  Revenue: ${result['data']['revenue']['monthly']:,}")
        print(f"  Expenses: ${result['data']['expenses']['monthly']:,}")
        print(f"  Health Score: {result['data']['healthScore']['overall']}/100")
        print("\n🔄 Refresh your browser to see the data!")
    else:
        print(f"❌ Error: {response.text}")

if __name__ == "__main__":
    # UPDATE THIS PATH to your Excel file location
    file_path = r"C:\Users\HCSUSER\Downloads\your_trial_balance.xlsx"
    
    print(f"Uploading: {file_path}")
    upload_trial_balance(file_path)
