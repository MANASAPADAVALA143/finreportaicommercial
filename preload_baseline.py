import requests, pandas as pd, numpy as np

df = pd.read_excel("journal_entries_sample_APP.xlsx")
df["posting_date"] = pd.to_datetime(df["posting_date"]).dt.strftime("%Y-%m-%d")

months = ["2024-08","2024-09","2024-10","2024-11","2024-12","2025-01"]
chunks = np.array_split(df, 6)

for month, chunk in zip(months, chunks):
    entries = []
    for _, row in chunk.iterrows():
        entries.append({
            "journal_id":   f"{month}-{row['journal_id']}",
            "posting_date": row["posting_date"],
            "account":      row["account"],
            "amount":       float(row["amount"]),
            "user_id":      row["user_id"],
            "source":       row["source"],
            "description":  str(row.get("description", "")),
            "entity":       str(row.get("entity", ""))
        })

    r = requests.post(
        "http://localhost:8000/api/v2/history/upload",
        json={
            "company_id":   "gnanova_demo",
            "upload_month": month,
            "entries":      entries
        }
    )
    print(f"✅ {month}: {r.json().get('saved')} entries saved")

print("\n🎯 Done! 6 months loaded. Run the app and check Tab 2.")
