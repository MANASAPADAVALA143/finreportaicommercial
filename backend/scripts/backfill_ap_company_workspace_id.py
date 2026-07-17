"""
Backfill Supabase companies.workspace_id for orphan AP tenants.

Typical case: bulk-imported invoices land on slug=my-company with workspace_id NULL,
so POST /api/workspaces/{id}/sync-ap-company cannot find the row and returns 503
(or inserts a second empty company).

Usage:
  cd backend
  python scripts/backfill_ap_company_workspace_id.py --workspace-id <uuid>
  python scripts/backfill_ap_company_workspace_id.py --workspace-id <uuid> --company-id 0deaa402-...
  python scripts/backfill_ap_company_workspace_id.py --list
  python scripts/backfill_ap_company_workspace_id.py --dry-run --workspace-id <uuid>
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / ".env")

from app.core.supabase import get_supabase  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill companies.workspace_id")
    parser.add_argument("--list", action="store_true", help="List companies and exit")
    parser.add_argument("--workspace-id", help="FinReport workspace UUID to link")
    parser.add_argument("--company-id", help="Specific companies.id (default: sole orphan / my-company)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    sb = get_supabase()
    rows = (sb.table("companies").select("id,name,slug,workspace_id").execute().data) or []

    if args.list or not args.workspace_id:
        print(f"{'id':36}  {'workspace_id':36}  name")
        for r in rows:
            print(f"{r.get('id'):36}  {str(r.get('workspace_id') or 'NULL'):36}  {r.get('name')}")
        if not args.workspace_id:
            print("\nPass --workspace-id <uuid> to link an orphan company.")
            return 0

    orphans = [r for r in rows if not r.get("workspace_id")]
    target = None
    if args.company_id:
        target = next((r for r in rows if r.get("id") == args.company_id), None)
        if not target:
            print(f"Company not found: {args.company_id}", file=sys.stderr)
            return 1
    elif len(orphans) == 1:
        target = orphans[0]
    else:
        target = next((r for r in orphans if (r.get("slug") or "") == "my-company"), None)

    if not target:
        print(
            f"Could not pick target company ({len(orphans)} orphans). "
            "Pass --company-id explicitly.",
            file=sys.stderr,
        )
        return 1

    if target.get("workspace_id") and target["workspace_id"] != args.workspace_id:
        print(
            f"Company {target['id']} already linked to {target['workspace_id']}. "
            "Refusing to overwrite.",
            file=sys.stderr,
        )
        return 1

    print(f"Link {target.get('name')} ({target['id']}) → workspace {args.workspace_id}")
    if args.dry_run:
        print("Dry run — no update.")
        return 0

    updated = (
        sb.table("companies")
        .update({"workspace_id": args.workspace_id})
        .eq("id", target["id"])
        .select("id,name,workspace_id")
        .maybe_single()
        .execute()
    )
    print("Updated:", updated.data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
