"""
GROUP A — PostgreSQL Row-Lock Concurrency Verification
Commit scope: 512edac

Two genuine concurrent sessions race to post a receipt against the same
invoice.  The test proves:
  - Session B is blocked by Session A's FOR UPDATE row lock
  - Exactly one receipt JE is created
  - Session B sees the updated outstanding AFTER Session A commits,
    and rejects any attempt that would exceed the remaining balance
  - Final invoice and GL balances are consistent

No application code is changed.  Disposable test data only.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
import uuid
from datetime import date
from typing import Any

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_READ_COMMITTED

# ── connection ────────────────────────────────────────────────────────────────

PG_HOST     = os.getenv("VERIFY_PG_HOST",     "localhost")
PG_PORT     = int(os.getenv("VERIFY_PG_PORT", "55432"))
PG_USER     = os.getenv("VERIFY_PG_USER",     "postgres")
PG_PASSWORD = os.getenv("VERIFY_PG_PASSWORD", "postgres")
PG_DB       = os.getenv("VERIFY_PG_DB",       "ga_verify_512edac")  # existing container DB

LOCK_TIMEOUT_MS = 5_000   # Session B waits up to 5 s for the lock
INVOICE_TOTAL   = 1_000.00  # AED

def _connect(dbname: str = PG_DB) -> psycopg2.extensions.connection:
    conn = psycopg2.connect(
        host=PG_HOST, port=PG_PORT,
        user=PG_USER, password=PG_PASSWORD,
        dbname=dbname, connect_timeout=5,
    )
    conn.set_isolation_level(ISOLATION_LEVEL_READ_COMMITTED)
    return conn


# ── minimal schema (idempotent, dropped at the end) ───────────────────────────

SCHEMA_PREFIX = "conc_test"   # all table names are prefixed to stay isolated

DDL = f"""
CREATE TABLE IF NOT EXISTS {SCHEMA_PREFIX}_invoices (
    id              TEXT PRIMARY KEY,
    invoice_number  TEXT NOT NULL,
    total_amount    NUMERIC(15,2) NOT NULL,
    outstanding     NUMERIC(15,2) NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open',
    CONSTRAINT uq_{SCHEMA_PREFIX}_inv_num UNIQUE (invoice_number)
);

CREATE TABLE IF NOT EXISTS {SCHEMA_PREFIX}_receipts (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL REFERENCES {SCHEMA_PREFIX}_invoices(id),
    amount          NUMERIC(15,2) NOT NULL,
    session_label   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_{SCHEMA_PREFIX}_receipt_inv UNIQUE (invoice_id)  -- one receipt per invoice
);

CREATE TABLE IF NOT EXISTS {SCHEMA_PREFIX}_je (
    id              TEXT PRIMARY KEY,
    invoice_id      TEXT NOT NULL,
    receipt_id      TEXT NOT NULL REFERENCES {SCHEMA_PREFIX}_receipts(id),
    amount          NUMERIC(15,2) NOT NULL,
    session_label   TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_{SCHEMA_PREFIX}_je_inv UNIQUE (invoice_id)  -- one JE per invoice
);
"""

DROP_DDL = f"""
DROP TABLE IF EXISTS {SCHEMA_PREFIX}_je      CASCADE;
DROP TABLE IF EXISTS {SCHEMA_PREFIX}_receipts CASCADE;
DROP TABLE IF EXISTS {SCHEMA_PREFIX}_invoices CASCADE;
"""


def setup_schema() -> None:
    conn = _connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(DDL)
    conn.close()


def teardown_schema() -> None:
    conn = _connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(DROP_DDL)
    conn.close()


def insert_invoice(amount: float) -> str:
    inv_id  = str(uuid.uuid4())
    inv_num = f"CONC-{uuid.uuid4().hex[:8].upper()}"
    conn = _connect()
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(
        f"INSERT INTO {SCHEMA_PREFIX}_invoices (id, invoice_number, total_amount, outstanding) "
        f"VALUES (%s, %s, %s, %s)",
        (inv_id, inv_num, amount, amount),
    )
    conn.close()
    return inv_id


# ── receipt posting (the critical section) ───────────────────────────────────

class InsufficientOutstandingError(Exception):
    pass


class DuplicateReceiptError(Exception):
    pass


def post_receipt(
    conn: psycopg2.extensions.connection,
    invoice_id: str,
    receipt_amount: float,
    session_label: str,
) -> dict[str, Any]:
    """
    Post a receipt against an invoice inside an *already-open* transaction.

    1. Acquires a FOR UPDATE row lock on the invoice.
    2. Checks outstanding >= receipt_amount.
    3. Inserts receipt + JE rows (UNIQUE constraints prevent double-entry).
    4. Decrements outstanding.

    Caller must COMMIT or ROLLBACK.
    """
    cur = conn.cursor()

    # 1. Lock the invoice row — blocks any concurrent session attempting the same
    cur.execute(
        f"SELECT outstanding, status FROM {SCHEMA_PREFIX}_invoices "
        f"WHERE id = %s FOR UPDATE",
        (invoice_id,),
    )
    row = cur.fetchone()
    if not row:
        raise ValueError(f"Invoice {invoice_id} not found")
    outstanding, status = float(row[0]), row[1]

    # 2. Guard: reject if receipt would exceed outstanding
    if receipt_amount > outstanding:
        raise InsufficientOutstandingError(
            f"[{session_label}] receipt {receipt_amount} > outstanding {outstanding}"
        )

    # 3. Insert receipt (UNIQUE on invoice_id raises on duplicate)
    receipt_id = str(uuid.uuid4())
    try:
        cur.execute(
            f"INSERT INTO {SCHEMA_PREFIX}_receipts "
            f"(id, invoice_id, amount, session_label) VALUES (%s, %s, %s, %s)",
            (receipt_id, invoice_id, receipt_amount, session_label),
        )
    except psycopg2.errors.UniqueViolation:
        raise DuplicateReceiptError(
            f"[{session_label}] duplicate receipt for invoice {invoice_id}"
        )

    # 4. Insert JE (UNIQUE on invoice_id raises on duplicate)
    je_id = str(uuid.uuid4())
    try:
        cur.execute(
            f"INSERT INTO {SCHEMA_PREFIX}_je "
            f"(id, invoice_id, receipt_id, amount, session_label) VALUES (%s, %s, %s, %s, %s)",
            (je_id, invoice_id, receipt_id, receipt_amount, session_label),
        )
    except psycopg2.errors.UniqueViolation:
        raise DuplicateReceiptError(
            f"[{session_label}] duplicate JE for invoice {invoice_id}"
        )

    # 5. Decrement outstanding
    new_outstanding = round(outstanding - receipt_amount, 2)
    new_status = "paid" if new_outstanding == 0.00 else "partial"
    cur.execute(
        f"UPDATE {SCHEMA_PREFIX}_invoices "
        f"SET outstanding = %s, status = %s WHERE id = %s",
        (new_outstanding, new_status, invoice_id),
    )

    return {
        "receipt_id": receipt_id,
        "je_id": je_id,
        "outstanding_before": outstanding,
        "outstanding_after": new_outstanding,
        "status": new_status,
    }


# ── concurrency test ──────────────────────────────────────────────────────────

class SessionLog:
    def __init__(self, label: str):
        self.label   = label
        self.events: list[dict] = []
        self.result: dict       = {}
        self.error:  str        = ""
        self.backend_pid: int   = 0

    def log(self, event: str, **kw):
        entry = {"t": round(time.monotonic(), 4), "event": event, **kw}
        self.events.append(entry)

    def as_dict(self) -> dict:
        return {
            "session":     self.label,
            "backend_pid": self.backend_pid,
            "events":      self.events,
            "result":      self.result,
            "error":       self.error,
        }


def run_session_a(
    invoice_id: str,
    receipt_amount: float,
    log: SessionLog,
    b_waiting: threading.Event,
    a_commit_go: threading.Event,
) -> None:
    """
    Session A:
      - Locks the row
      - Signals that it holds the lock (lets B start)
      - Waits until told to commit
      - Posts receipt and commits
    """
    conn = _connect()
    cur  = conn.cursor()
    cur.execute("SELECT pg_backend_pid()")
    log.backend_pid = cur.fetchone()[0]

    try:
        log.log("begin_tx")
        # Acquire FOR UPDATE lock — B will block on this
        cur.execute(
            f"SELECT outstanding FROM {SCHEMA_PREFIX}_invoices WHERE id = %s FOR UPDATE",
            (invoice_id,),
        )
        outstanding = float(cur.fetchone()[0])
        log.log("lock_acquired", outstanding=outstanding)

        # Tell B it can now try (it will block on the same row lock)
        b_waiting.set()

        # Hold the lock long enough for B to block, then post receipt
        a_commit_go.wait(timeout=10)
        log.log("posting_receipt", amount=receipt_amount)

        result = post_receipt(conn, invoice_id, receipt_amount, session_label="A")
        conn.commit()
        log.log("committed", **result)
        log.result = result

    except Exception as exc:
        conn.rollback()
        log.error = str(exc)
        log.log("error", msg=str(exc))
    finally:
        conn.close()


def run_session_b(
    invoice_id: str,
    receipt_amount: float,
    log: SessionLog,
    b_waiting: threading.Event,
    lock_wait_observed: threading.Event,
    observer_conn,
) -> None:
    """
    Session B:
      - Waits until A holds the lock
      - Sets lock_timeout so it doesn't hang indefinitely
      - Attempts to post the same receipt (will block until A commits)
      - After A commits, re-reads outstanding and decides to accept or reject
    """
    b_waiting.wait(timeout=10)   # wait for A to acquire the lock first

    conn = _connect()
    cur  = conn.cursor()
    cur.execute("SELECT pg_backend_pid()")
    log.backend_pid = cur.fetchone()[0]

    try:
        # Set a lock_timeout so the test cannot hang
        cur.execute(f"SET lock_timeout = '{LOCK_TIMEOUT_MS}ms'")
        log.log("begin_tx", lock_timeout_ms=LOCK_TIMEOUT_MS)
        log.log("attempting_lock_on_invoice", invoice_id=invoice_id)

        # This SELECT FOR UPDATE will block until A commits or times out
        t0 = time.monotonic()
        cur.execute(
            f"SELECT outstanding FROM {SCHEMA_PREFIX}_invoices WHERE id = %s FOR UPDATE",
            (invoice_id,),
        )
        wait_ms = round((time.monotonic() - t0) * 1000, 1)
        outstanding = float(cur.fetchone()[0])
        log.log("lock_acquired_after_wait", wait_ms=wait_ms, outstanding_seen=outstanding)
        lock_wait_observed.set()

        # B sees A's committed outstanding — if zero or insufficient, reject
        if receipt_amount > outstanding:
            conn.rollback()
            log.log("rejected_insufficient_outstanding",
                    receipt_amount=receipt_amount, outstanding=outstanding)
            log.result = {
                "skipped": True,
                "reason": "insufficient_outstanding",
                "outstanding_seen": outstanding,
            }
            return

        # If there were still balance, B would post here
        # (in this test we expect rejection since A consumed the full amount)
        result = post_receipt(conn, invoice_id, receipt_amount, session_label="B")
        conn.commit()
        log.log("committed", **result)
        log.result = result

    except psycopg2.errors.LockNotAvailable:
        conn.rollback()
        log.error = "lock_timeout — lock not released within timeout"
        log.log("lock_timeout")
    except (InsufficientOutstandingError, DuplicateReceiptError) as exc:
        conn.rollback()
        log.error = str(exc)
        log.log("rejected", reason=str(exc))
        log.result = {"skipped": True, "reason": str(exc)}
    except Exception as exc:
        conn.rollback()
        log.error = str(exc)
        log.log("error", msg=str(exc))
    finally:
        conn.close()


def observe_locks(
    invoice_id: str,
    b_waiting: threading.Event,
    lock_wait_observed: threading.Event,
    lock_samples: list,
) -> None:
    """Sample pg_locks while B is waiting for A's row lock."""
    b_waiting.wait(timeout=10)
    conn = _connect()
    cur  = conn.cursor()
    deadline = time.monotonic() + 4   # sample for up to 4 s
    while time.monotonic() < deadline and not lock_wait_observed.is_set():
        cur.execute("""
            SELECT
                w.pid               AS waiting_pid,
                b.pid               AS blocking_pid,
                w.locktype,
                w.transactionid,
                w.mode,
                w.granted
            FROM pg_locks w
            JOIN pg_locks b
              ON  b.locktype        = w.locktype
              AND b.transactionid   = w.transactionid
              AND b.granted         = TRUE
              AND w.granted         = FALSE
            WHERE w.locktype = 'transactionid'
        """)
        rows = cur.fetchall()
        if rows:
            for r in rows:
                lock_samples.append({
                    "waiting_pid":   r[0],
                    "blocking_pid":  r[1],
                    "locktype":      r[2],
                    "transactionid": str(r[3]),
                    "mode":          r[4],
                    "granted":       r[5],
                })
        time.sleep(0.05)
    conn.close()


def final_state(invoice_id: str) -> dict:
    conn = _connect()
    cur  = conn.cursor()
    cur.execute(
        f"SELECT outstanding, status FROM {SCHEMA_PREFIX}_invoices WHERE id = %s",
        (invoice_id,),
    )
    inv = cur.fetchone()
    cur.execute(
        f"SELECT COUNT(*), SUM(amount) FROM {SCHEMA_PREFIX}_receipts WHERE invoice_id = %s",
        (invoice_id,),
    )
    rec = cur.fetchone()
    cur.execute(
        f"SELECT COUNT(*), SUM(amount) FROM {SCHEMA_PREFIX}_je WHERE invoice_id = %s",
        (invoice_id,),
    )
    je = cur.fetchone()
    conn.close()
    return {
        "outstanding":    float(inv[0]),
        "status":         inv[1],
        "receipt_count":  int(rec[0] or 0),
        "receipt_total":  float(rec[1] or 0),
        "je_count":       int(je[0] or 0),
        "je_total":       float(je[1] or 0),
    }


# ── run ───────────────────────────────────────────────────────────────────────

def run_concurrency_test() -> dict[str, Any]:
    invoice_id = insert_invoice(INVOICE_TOTAL)

    log_a = SessionLog("A")
    log_b = SessionLog("B")
    lock_samples: list = []

    b_waiting          = threading.Event()
    a_commit_go        = threading.Event()
    lock_wait_observed = threading.Event()

    observer_conn = _connect()

    # Wire up threads
    t_a = threading.Thread(
        target=run_session_a,
        args=(invoice_id, INVOICE_TOTAL, log_a, b_waiting, a_commit_go),
        daemon=True,
    )
    t_b = threading.Thread(
        target=run_session_b,
        args=(invoice_id, INVOICE_TOTAL, log_b, b_waiting, lock_wait_observed, observer_conn),
        daemon=True,
    )
    t_obs = threading.Thread(
        target=observe_locks,
        args=(invoice_id, b_waiting, lock_wait_observed, lock_samples),
        daemon=True,
    )

    t_a.start()
    t_obs.start()

    # Give A a moment to acquire the lock, then let B race
    time.sleep(0.3)
    t_b.start()

    # Give B time to block on the row lock, then tell A to commit
    time.sleep(0.5)
    a_commit_go.set()

    t_a.join(timeout=10)
    t_b.join(timeout=10)
    t_obs.join(timeout=5)
    observer_conn.close()

    state = final_state(invoice_id)

    # ── acceptance criteria ──────────────────────────────────────────────────
    lock_wait_seen = len(lock_samples) > 0

    a_succeeded   = bool(log_a.result.get("receipt_id")) and not log_a.error
    b_rejected    = (
        log_b.result.get("skipped") is True
        or "insufficient" in log_b.error.lower()
        or "insufficient" in str(log_b.result.get("reason", "")).lower()
        or "duplicate" in log_b.error.lower()
    )

    exactly_one_receipt = state["receipt_count"] == 1
    exactly_one_je      = state["je_count"] == 1
    outstanding_zero    = state["outstanding"] == 0.00
    balances_match      = round(state["receipt_total"], 2) == round(state["je_total"], 2) == INVOICE_TOTAL

    passed = (
        lock_wait_seen
        and a_succeeded
        and b_rejected
        and exactly_one_receipt
        and exactly_one_je
        and outstanding_zero
        and balances_match
    )

    return {
        "test": "GROUP_A_CONCURRENCY",
        "commit_scope": "512edac",
        "invoice_id":   invoice_id,
        "invoice_total": INVOICE_TOTAL,
        "passed": passed,
        "acceptance_criteria": {
            "lock_wait_observed":   lock_wait_seen,
            "session_a_succeeded":  a_succeeded,
            "session_b_rejected":   b_rejected,
            "exactly_one_receipt":  exactly_one_receipt,
            "exactly_one_je":       exactly_one_je,
            "outstanding_zero":     outstanding_zero,
            "receipt_je_balances_match": balances_match,
        },
        "final_state":   state,
        "lock_samples":  lock_samples[:10],  # first 10 captures
        "session_a_log": log_a.as_dict(),
        "session_b_log": log_b.as_dict(),
    }


# ── entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="-")
    parser.add_argument("--keep-schema", action="store_true")
    args = parser.parse_args()

    print("Setting up schema …", file=sys.stderr)
    setup_schema()

    try:
        print("Running concurrency test …", file=sys.stderr)
        result = run_concurrency_test()
    finally:
        if not args.keep_schema:
            teardown_schema()

    text = json.dumps(result, indent=2, default=str)
    if args.out == "-":
        print(text)
    else:
        with open(args.out, "w") as f:
            f.write(text)
        print(f"Results written to {args.out}", file=sys.stderr)

    verdict = "PASS" if result["passed"] else "FAIL"
    print(f"\nOverall: {verdict}", file=sys.stderr)
    sys.exit(0 if result["passed"] else 1)
