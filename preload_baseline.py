import argparse
from datetime import datetime, timedelta
from pathlib import Path
import random
import sys
import uuid

import numpy as np
import pandas as pd
import requests
from requests import RequestException


BASE_URL = "http://127.0.0.1:8000/api/v2/history"
COMPANY_ID = "gnanova_demo"
MONTHS = ["2024-08", "2024-09", "2024-10", "2024-11", "2024-12", "2025-01"]
SAMPLE_FILENAME = "journal_entries_sample_APP.xlsx"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def find_input_file() -> Path | None:
    candidates = [
        Path.cwd() / SAMPLE_FILENAME,
        Path.cwd() / "backend" / SAMPLE_FILENAME,
        Path.cwd() / "backend" / "data" / SAMPLE_FILENAME,
        Path(r"C:\Users\HCSUSER\OneDrive\Desktop\CFO") / SAMPLE_FILENAME,
        Path(r"C:\Users\HCSUSER\Downloads") / SAMPLE_FILENAME,
    ]
    for p in candidates:
        if p.exists():
            print(f"[OK] Found input file: {p}")
            return p
    return None


def generate_sample_file(target: Path) -> Path:
    accounts = [
        ("REVENUE", "Revenue", "Income"),
        ("COGS", "Cost of Goods Sold", "Expense"),
        ("SALARY", "Salary Expense", "Expense"),
        ("RENT", "Rent Expense", "Expense"),
        ("BANK", "Bank Account", "Asset"),
        ("AR", "Accounts Receivable", "Asset"),
        ("AP", "Accounts Payable", "Liability"),
        ("TAX", "Tax Payable", "Liability"),
    ]
    users = ["raj.kumar", "priya.s", "admin", "finance.mgr", "new_user"]
    sources = ["SAP", "Manual", "System", "Excel"]

    rows: list[dict] = []
    for month_offset in range(6):
        month_start = datetime(2024 + (7 + month_offset) // 12, ((7 + month_offset) % 12) + 1, 1)
        for i in range(83):
            acc = random.choice(accounts)
            amount = round(random.uniform(5000, 500000), 2)
            if random.random() < 0.05:
                amount = amount * random.uniform(8, 15)
            rows.append(
                {
                    "Date": (month_start + timedelta(days=random.randint(0, 27))).strftime("%Y-%m-%d"),
                    "Amount": amount,
                    "Debit": acc[0],
                    "Credit": random.choice(accounts)[0],
                    "Description": f"{acc[1]} entry {i + 1}",
                    "User_ID": random.choice(users),
                    "Source": random.choice(sources),
                    "Journal_ID": str(uuid.uuid4())[:8],
                }
            )

    df = pd.DataFrame(rows)
    df.to_excel(target, index=False)
    print(f"✅ Generated {len(df)} entries across 6 months at: {target}")
    return target


def to_entries(df: pd.DataFrame, month: str, default_entity: str = "GNANOVA") -> list[dict]:
    colmap = {c.lower().strip(): c for c in df.columns}
    date_col = colmap.get("posting_date") or colmap.get("date")
    amount_col = colmap.get("amount")
    account_col = colmap.get("account") or colmap.get("debit")
    user_col = colmap.get("user_id")
    source_col = colmap.get("source")
    desc_col = colmap.get("description")
    entity_col = colmap.get("entity")
    journal_col = colmap.get("journal_id")

    if not date_col or not amount_col or not account_col:
        raise ValueError(
            "Input file must contain date/posting_date, amount, and account/debit columns."
        )

    out: list[dict] = []
    for i, row in df.iterrows():
        dt = pd.to_datetime(row[date_col]).strftime("%Y-%m-%d")
        jid_raw = row[journal_col] if journal_col else f"auto-{month}-{i+1}"
        out.append(
            {
                "journal_id": f"{month}-{jid_raw}",
                "posting_date": dt,
                "account": str(row[account_col]),
                "amount": float(row[amount_col]),
                "user_id": str(row[user_col]) if user_col else "system",
                "source": str(row[source_col]) if source_col else "System",
                "description": str(row[desc_col]) if desc_col else "",
                "entity": str(row[entity_col]) if entity_col else default_entity,
            }
        )
    return out


def reset_company() -> None:
    try:
        r = requests.delete(
            f"{BASE_URL}/reset",
            params={"company_id": COMPANY_ID},
            timeout=30,
        )
        r.raise_for_status()
        print(f"[OK] Reset company baseline: {r.json()}")
    except RequestException as exc:
        raise SystemExit(
            "[ERROR] Could not reach backend at http://127.0.0.1:8000. "
            "Start FastAPI first, then rerun this script."
        ) from exc


def upload_six_months(df: pd.DataFrame) -> None:
    chunks = np.array_split(df, 6)
    for month, chunk in zip(MONTHS, chunks):
        entries = to_entries(chunk, month)
        r = requests.post(
            f"{BASE_URL}/upload",
            json={"company_id": COMPANY_ID, "upload_month": month, "entries": entries},
            timeout=90,
        )
        try:
            r.raise_for_status()
        except RequestException as exc:
            raise SystemExit(
                f"[ERROR] Upload failed for {month}. Check backend logs and retry."
            ) from exc
        saved = r.json().get("saved", len(entries))
        print(f"✅ {month}: {saved} entries saved")


def print_baseline_status() -> None:
    try:
        r = requests.get(
            f"{BASE_URL}/baseline-status",
            params={"company_id": COMPANY_ID},
            timeout=30,
        )
        r.raise_for_status()
    except RequestException as exc:
        raise SystemExit(
            "[ERROR] Could not fetch baseline status. Ensure backend is running and retry."
        ) from exc
    payload = r.json()
    print("\nBaseline status:")
    print(payload)
    months_loaded = payload.get("months_loaded")
    quality = payload.get("quality")
    print(f"\n🎯 Done! months_loaded: {months_loaded}, quality: {quality}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Preload baseline history for gnanova_demo")
    parser.add_argument("--reset", action="store_true", help="Reset existing gnanova_demo baseline and reload.")
    args = parser.parse_args()

    if args.reset:
        reset_company()

    file_path = find_input_file()
    if file_path is None:
        file_path = generate_sample_file(Path.cwd() / SAMPLE_FILENAME)

    df = pd.read_excel(file_path)
    print(f"[OK] Loaded rows: {len(df)}")
    upload_six_months(df)
    print_baseline_status()


if __name__ == "__main__":
    main()
