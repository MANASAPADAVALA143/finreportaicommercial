#!/usr/bin/env python3
import json, os, urllib.request, urllib.error
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
base = os.getenv("SUPABASE_URL", "").rstrip("/")
key = os.getenv("SUPABASE_KEY", "")
h = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation"}

for col in ["risk_score", "risk_flags", "risk_level", "risk_flag_count", "risk_details"]:
    try:
        urllib.request.urlopen(urllib.request.Request(f"{base}/rest/v1/invoices?select={col}&limit=1", headers=h))
        print(col, "OK")
    except urllib.error.HTTPError as e:
        print(col, json.loads(e.read()).get("message"))

inv = json.loads(urllib.request.urlopen(urllib.request.Request(
    f"{base}/rest/v1/invoices?select=id,invoice_number,risk_score&invoice_number=eq.INV-2026-001&limit=1", headers=h
)).read())
if inv:
    i = inv[0]
    for label, payload in [
        ("numeric", {"risk_score": 25, "risk_flags": []}),
        ("text_low", {"risk_score": "low", "risk_flags": []}),
        ("text_Low", {"risk_score": "Low", "risk_flags": []}),
    ]:
        try:
            req = urllib.request.Request(
                f"{base}/rest/v1/invoices?id=eq.{i['id']}",
                data=json.dumps(payload).encode(),
                headers=h,
                method="PATCH",
            )
            urllib.request.urlopen(req)
            print("patch", label, "OK")
        except urllib.error.HTTPError as e:
            print("patch", label, "FAIL", json.loads(e.read()).get("message", "")[:150])
