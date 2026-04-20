#!/usr/bin/env python3
"""
FinReportAI — Tally Connector
Runs automatically on client's PC every night.
Exports Trial Balance from Tally → FinReportAI.

Setup: python tally_connector.py --setup
Run:   python tally_connector.py --run
"""

from __future__ import annotations

import argparse
import calendar
import json
import logging
import re
import sys
import xml.etree.ElementTree as ET
from datetime import date, datetime
from pathlib import Path

import requests

_ROOT = Path(__file__).resolve().parent

# ─────────────────────────────────────
# CLIENT CONFIGURATION
# Edit these for each client install
# ─────────────────────────────────────

CONFIG = {
    "tally_host": "localhost",
    "tally_port": 9000,
    "tally_company_name": "",
    "api_url": "https://api.finreportai.com",
    "api_key": "",
    "entity_id": "",
    "currency": "INR",
    "fiscal_year_start_month": 4,
    "sync_current_year": True,
    "sync_prior_years": 2,
    "run_hour": 0,
    "run_minute": 30,
    "log_file": "tally_connector.log",
    "config_file": "connector_config.json",
}


def _log_path(name: str) -> str:
    return str(_ROOT / name)


def setup_logging(log_file: str) -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.FileHandler(log_file, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
        force=True,
    )
    return logging.getLogger(__name__)


logger = setup_logging(_log_path(CONFIG["log_file"]))


def test_tally_connection(host: str, port: int) -> dict:
    """Test if Tally is running."""
    xml = """
    <ENVELOPE>
      <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
      </HEADER>
      <BODY>
        <EXPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>List of Companies</REPORTNAME>
            <STATICVARIABLES>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
            </STATICVARIABLES>
          </REQUESTDESC>
        </EXPORTDATA>
      </BODY>
    </ENVELOPE>
    """
    try:
        resp = requests.post(
            f"http://{host}:{port}",
            data=xml.encode("utf-8"),
            headers={"Content-Type": "text/xml"},
            timeout=10,
        )
        if resp.status_code == 200:
            companies = extract_companies(resp.text)
            return {"success": True, "companies": companies}
    except requests.exceptions.ConnectionError:
        return {
            "success": False,
            "error": "Tally not running. Please open Tally first.",
        }
    except Exception as e:
        return {"success": False, "error": str(e)}
    return {"success": False, "error": f"Tally HTTP {resp.status_code}"}


def extract_companies(xml_str: str) -> list:
    companies = []
    try:
        root = ET.fromstring(xml_str)
        for c in root.iter("COMPANY"):
            name = c.findtext("NAME") or c.text
            if name and name.strip():
                companies.append(name.strip())
    except ET.ParseError:
        pass
    return companies


def fetch_trial_balance(
    host: str,
    port: int,
    company: str,
    from_date: date,
    to_date: date,
) -> list:
    """Fetch Trial Balance XML from Tally."""
    xml = f"""
    <ENVELOPE>
      <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
      </HEADER>
      <BODY>
        <EXPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>Trial Balance</REPORTNAME>
            <STATICVARIABLES>
              <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
              <SVFROMDATE>{from_date.strftime('%Y%m%d')}</SVFROMDATE>
              <SVTODATE>{to_date.strftime('%Y%m%d')}</SVTODATE>
              <SVCURRENTCOMPANY>{company}</SVCURRENTCOMPANY>
              <SVSHOWALLLEDGERS>Yes</SVSHOWALLLEDGERS>
            </STATICVARIABLES>
          </REQUESTDESC>
        </EXPORTDATA>
      </BODY>
    </ENVELOPE>
    """

    logger.info(
        "Fetching TB from Tally: %s (%s to %s)", company, from_date, to_date
    )

    resp = requests.post(
        f"http://{host}:{port}",
        data=xml.encode("utf-8"),
        headers={"Content-Type": "text/xml"},
        timeout=120,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Tally HTTP {resp.status_code}")
    return parse_tally_tb(resp.text)


def parse_tally_tb(xml_str: str) -> list:
    """Parse Tally XML into list of GL rows."""
    rows = []
    counter = 1

    try:
        root = ET.fromstring(xml_str)
    except ET.ParseError:
        xml_str = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", xml_str)
        root = ET.fromstring(xml_str)

    for ledger in root.iter("LEDGER"):
        name = (
            ledger.get("NAME")
            or ledger.findtext("NAME")
            or ledger.findtext("LEDGERNAME")
            or ""
        ).strip()

        if not name:
            continue

        balance_text = (
            ledger.findtext("CLOSINGBALANCE")
            or ledger.findtext("OPENINGBALANCE")
            or "0"
        )

        amount, is_debit = parse_amount(balance_text)
        group = ledger.findtext("PARENT") or ""

        rows.append(
            {
                "gl_code": f"T{counter:04d}",
                "gl_description": name,
                "tally_group": group,
                "debit": round(amount, 2) if is_debit else 0,
                "credit": 0 if is_debit else round(amount, 2),
            }
        )
        counter += 1

    logger.info("Parsed %s ledger accounts from Tally", len(rows))
    return rows


def parse_amount(s: str) -> tuple:
    s = str(s).strip()
    is_debit = True

    if s.upper().endswith(" DR"):
        s = s[:-3].strip()
    elif s.upper().endswith(" CR"):
        is_debit = False
        s = s[:-3].strip()
    elif s.startswith("-"):
        is_debit = False
        s = s[1:].strip()

    s = s.replace(",", "")
    try:
        return float(s), is_debit
    except ValueError:
        return 0.0, True


def send_to_finreportai(
    rows: list,
    config: dict,
    period_from: date,
    period_to: date,
    fiscal_year: str,
) -> dict:
    """Send TB data to FinReportAI API."""
    base = config["api_url"].rstrip("/")
    payload = {
        "entity_id": config["entity_id"],
        "company_name": config["tally_company_name"],
        "source": "tally_connector",
        "fiscal_year": fiscal_year,
        "period_from": period_from.isoformat(),
        "period_to": period_to.isoformat(),
        "currency": config["currency"],
        "gl_rows": rows,
        "auto_generate_statements": True,
        "send_notification": True,
    }

    headers = {
        "Content-Type": "application/json",
        "X-API-Key": config["api_key"],
        "X-Source": "tally-connector-v1",
    }

    logger.info("Sending %s rows to FinReportAI API...", len(rows))

    resp = requests.post(
        f"{base}/api/erp/tally/connector-sync",
        json=payload,
        headers=headers,
        timeout=120,
    )

    if resp.status_code == 200:
        result = resp.json()
        logger.info(
            "Success: TB ID=%s, Mapped=%s",
            result.get("trial_balance_id"),
            result.get("mapped_count"),
        )
        return result
    raise RuntimeError(f"API error {resp.status_code}: {resp.text[:200]}")


def get_month_end(year: int, month: int) -> int:
    return calendar.monthrange(year, month)[1]


def get_fiscal_year_dates(year: int, start_month: int = 4) -> tuple:
    """Fiscal year start and end (e.g. India April 1 – March 31)."""
    from_date = date(year, start_month, 1)
    if start_month == 1:
        to_date = date(year, 12, 31)
        fy_label = f"FY{year}"
    else:
        to_date = date(
            year + 1,
            start_month - 1,
            get_month_end(year + 1, start_month - 1),
        )
        fy_label = f"FY{year}-{str(year + 1)[2:]}"

    return from_date, to_date, fy_label


def get_current_fiscal_year(start_month: int = 4) -> int:
    today = date.today()
    if today.month >= start_month:
        return today.year
    return today.year - 1


def run_sync(config: dict) -> bool:
    """Main sync function — runs every night."""
    global logger
    log_file = _log_path(config.get("log_file") or CONFIG["log_file"])
    logger = setup_logging(log_file)

    logger.info("=" * 50)
    logger.info("FinReportAI Tally Connector — Starting sync")
    logger.info("Company: %s", config["tally_company_name"])
    logger.info("Time: %s", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    logger.info("=" * 50)

    conn_test = test_tally_connection(config["tally_host"], config["tally_port"])

    if not conn_test["success"]:
        logger.error("Tally not accessible: %s", conn_test["error"])
        logger.error("Sync aborted. Is Tally running?")
        return False

    logger.info("Tally connected successfully")

    current_fy = get_current_fiscal_year(config["fiscal_year_start_month"])
    years_to_sync = [current_fy]
    for i in range(1, config["sync_prior_years"] + 1):
        years_to_sync.append(current_fy - i)

    logger.info("Syncing fiscal years: %s", years_to_sync)

    results = []

    for year in years_to_sync:
        try:
            from_date, to_date, fy_label = get_fiscal_year_dates(
                year, config["fiscal_year_start_month"]
            )

            logger.info("Fetching %s: %s to %s", fy_label, from_date, to_date)

            rows = fetch_trial_balance(
                config["tally_host"],
                config["tally_port"],
                config["tally_company_name"],
                from_date,
                to_date,
            )

            if not rows:
                logger.warning("No data for %s — skipping", fy_label)
                continue

            result = send_to_finreportai(
                rows, config, from_date, to_date, fy_label
            )

            results.append(
                {
                    "year": fy_label,
                    "rows": len(rows),
                    "trial_balance_id": result.get("trial_balance_id"),
                    "status": "success",
                }
            )

            logger.info("%s: %s accounts synced OK", fy_label, len(rows))

        except Exception as e:
            logger.error("Failed to sync %s: %s", year, e)
            results.append({"year": year, "status": "error", "error": str(e)})

    success = [r for r in results if r["status"] == "success"]
    errors = [r for r in results if r["status"] == "error"]

    logger.info("=" * 50)
    logger.info("Sync complete: %s success, %s errors", len(success), len(errors))

    if success:
        logger.info("IFRS Statements will be generated automatically")
        logger.info("Login to FinReportAI to view results")

    return len(errors) == 0


def run_setup() -> None:
    """Interactive setup wizard for first install."""
    print("\n" + "=" * 50)
    print("FinReportAI Tally Connector — Setup")
    print("=" * 50)
    print("\nThis wizard will configure the connector")
    print("for automatic nightly sync.\n")

    config = CONFIG.copy()
    config["log_file"] = str(Path(config["log_file"]).name)
    config["config_file"] = str(Path(config["config_file"]).name)

    print("STEP 1: Tally Connection")
    print("-" * 30)
    config["tally_host"] = (
        input(f"Tally host [{config['tally_host']}]: ").strip()
        or config["tally_host"]
    )

    port_input = input(f"Tally port [{config['tally_port']}]: ").strip()
    if port_input:
        config["tally_port"] = int(port_input)

    print("\nTesting Tally connection...")
    result = test_tally_connection(config["tally_host"], config["tally_port"])

    if not result["success"]:
        print(f"\nCannot connect to Tally: {result['error']}")
        print("Make sure Tally is open, then run setup again.")
        return

    print("Connected to Tally.")

    companies = result.get("companies") or []
    if companies:
        print("\nCompanies found:")
        for i, c in enumerate(companies, 1):
            print(f"  {i}. {c}")

        idx = input(f"\nSelect company (1-{len(companies)}): ").strip()
        try:
            config["tally_company_name"] = companies[int(idx) - 1]
        except (ValueError, IndexError):
            config["tally_company_name"] = input("Enter company name: ").strip()
    else:
        config["tally_company_name"] = input("Company name in Tally: ").strip()

    print("\nSTEP 2: FinReportAI API")
    print("-" * 30)
    config["api_url"] = (
        input(f"API URL [{config['api_url']}]: ").strip() or config["api_url"]
    )

    config["api_key"] = input("API Key: ").strip()
    config["entity_id"] = input("Entity ID: ").strip()

    print("\nSTEP 3: Sync Settings")
    print("-" * 30)
    config["currency"] = (
        input(f"Currency [{config['currency']}]: ").strip() or config["currency"]
    )

    fy_month = input(
        "Fiscal year start month (4=April, 1=January) [4]: "
    ).strip()
    if fy_month:
        config["fiscal_year_start_month"] = int(fy_month)

    cfg_path = _ROOT / config["config_file"]
    with open(cfg_path, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    print("\nConfiguration saved to", cfg_path)

    print("\nSTEP 4: Schedule Automatic Sync")
    print("-" * 30)

    setup_windows_task = (
        input("Set up automatic nightly sync? (y/n) [y]: ").strip().lower() or "y"
    )

    if setup_windows_task == "y":
        script_path = Path(__file__).absolute()
        python_path = Path(sys.executable).absolute()

        task_cmd = (
            f'schtasks /create /tn "FinReportAI Tally Sync" '
            f'/tr "\\"{python_path}\\" \\"{script_path}\\" --run" '
            f'/sc DAILY /st 00:30 /f'
        )

        print("\nRun this command as Administrator:\n")
        print(task_cmd + "\n")

        run_now = input("Run sync now to test? (y/n) [y]: ").strip().lower() or "y"

        if run_now == "y":
            run_sync(config)

    print("\n" + "=" * 50)
    print("Setup complete!")
    print("Logs:", _log_path(config["log_file"]))
    print("=" * 50)


def load_config() -> dict:
    config = CONFIG.copy()
    cfg_name = config["config_file"]
    cfg_path = _ROOT / Path(cfg_name).name
    if cfg_path.exists():
        with open(cfg_path, encoding="utf-8") as f:
            saved = json.load(f)
            config.update(saved)
    config["log_file"] = str(Path(config.get("log_file") or "tally_connector.log").name)
    config["config_file"] = str(Path(config.get("config_file") or "connector_config.json").name)
    return config


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="FinReportAI Tally Connector")
    parser.add_argument("--setup", action="store_true", help="Run setup wizard")
    parser.add_argument("--run", action="store_true", help="Run sync now")
    parser.add_argument("--test", action="store_true", help="Test Tally connection only")

    args = parser.parse_args()

    if args.setup:
        run_setup()
    elif args.run:
        config = load_config()
        if not config.get("api_key"):
            print("Not configured. Run: python tally_connector.py --setup")
            sys.exit(1)
        success = run_sync(config)
        sys.exit(0 if success else 1)
    elif args.test:
        config = load_config()
        result = test_tally_connection(
            config["tally_host"],
            config["tally_port"],
        )
        print(json.dumps(result, indent=2))
    else:
        parser.print_help()
