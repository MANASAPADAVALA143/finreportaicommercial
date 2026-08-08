"""AR Collections Intelligence — Promises, Disputes, Human Queue, Analytics."""
from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ar/collections", tags=["AR Collections Intelligence"])


# ─── HELPERS ───────────────────────────────────────────────

def _tid(request: Request) -> str:
    """Extract tenant_id from request headers or query param."""
    return (
        request.headers.get("x-tenant-id")
        or request.query_params.get("tenant_id")
        or ""
    )

def _cid(request: Request) -> str:
    """Extract company_id from request headers or query param."""
    return (
        request.headers.get("x-company-id")
        or request.query_params.get("company_id")
        or ""
    )


# ─── MODELS ────────────────────────────────────────────────

class PromiseCreate(BaseModel):
    invoice_id: str
    invoice_number: str
    customer_name: str
    promised_date: date
    promised_amount: Optional[float] = None
    currency: str = "AED"
    notes: Optional[str] = None
    source: str = "manual"

class PromiseUpdate(BaseModel):
    status: str  # OPEN / KEPT / BROKEN
    notes: Optional[str] = None

class DisputeCreate(BaseModel):
    invoice_id: str
    invoice_number: str
    customer_name: str
    reason: str
    dispute_type: str = "general"
    internal_owner: Optional[str] = None
    sla_days: int = 14

class DisputeResolve(BaseModel):
    resolution_notes: str
    actioned_by: str

class QueueCreate(BaseModel):
    invoice_id: str
    invoice_number: str
    customer_name: str
    amount: float
    currency: str = "AED"
    days_overdue: int
    queue_type: str
    drafted_content: Optional[str] = None
    agent_summary: Optional[str] = None
    confidence_score: Optional[float] = None

class QueueAction(BaseModel):
    action: str  # approved / held / rejected
    actioned_by: str
    edited_content: Optional[str] = None

class ReplyEventCreate(BaseModel):
    invoice_id: Optional[str] = None
    invoice_number: Optional[str] = None
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    raw_snippet: str
    classified_intent: str
    confidence_score: float
    extracted_date: Optional[date] = None
    extracted_reason: Optional[str] = None
    action_taken: Optional[str] = None

class CustomerTagUpdate(BaseModel):
    customer_name: str
    tag: Optional[str] = None  # KEY / RISK / NEW / SILENT / null


# ─── PROMISES ──────────────────────────────────────────────

@router.get("/promises")
def list_promises(
    request: Request,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    sql = """
        SELECT p.*,
               i.status as invoice_status,
               i.outstanding,
               i.last_dunning_level
        FROM ar_promises p
        LEFT JOIN uae_sales_invoices i ON i.id = p.invoice_id
        WHERE p.tenant_id = :tenant_id
    """
    params: dict = {"tenant_id": tenant_id}

    if company_id:
        sql += " AND p.company_id = :company_id"
        params["company_id"] = company_id

    if status:
        sql += " AND p.status = :status"
        params["status"] = status

    sql += " ORDER BY p.promised_date ASC"

    rows = db.execute(text(sql), params).mappings().all()
    return {"promises": [dict(r) for r in rows], "total": len(rows)}


@router.post("/promises")
def create_promise(
    body: PromiseCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    promise_id = str(uuid.uuid4())

    db.execute(text("""
        INSERT INTO ar_promises
          (id, tenant_id, company_id, invoice_id, invoice_number,
           customer_name, promised_date, promised_amount, currency,
           notes, source, status, created_at)
        VALUES
          (:id, :tenant_id, :company_id, :invoice_id, :invoice_number,
           :customer_name, :promised_date, :promised_amount, :currency,
           :notes, :source, 'OPEN', NOW())
    """), {
        "id": promise_id,
        "tenant_id": tenant_id,
        "company_id": company_id,
        "invoice_id": body.invoice_id,
        "invoice_number": body.invoice_number,
        "customer_name": body.customer_name,
        "promised_date": body.promised_date,
        "promised_amount": body.promised_amount,
        "currency": body.currency,
        "notes": body.notes,
        "source": body.source,
    })

    # Pause dunning on invoice until promised date
    db.execute(text("""
        UPDATE uae_sales_invoices
        SET has_open_promise = TRUE,
            dunning_paused = TRUE,
            dunning_pause_until = :promised_date
        WHERE id = :invoice_id
    """), {"promised_date": body.promised_date, "invoice_id": body.invoice_id})

    db.commit()

    return {
        "ok": True,
        "promise_id": promise_id,
        "message": f"Promise created. Dunning paused until {body.promised_date}."
    }


@router.patch("/promises/{promise_id}")
def update_promise(
    promise_id: str,
    body: PromiseUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)

    valid = {"OPEN", "KEPT", "BROKEN"}
    if body.status not in valid:
        raise HTTPException(400, f"status must be one of {valid}")

    resolved_at = datetime.utcnow() if body.status in ("KEPT", "BROKEN") else None

    row = db.execute(text("""
        UPDATE ar_promises
        SET status = :status,
            resolved_at = :resolved_at,
            notes = COALESCE(:notes, notes)
        WHERE id = :id AND tenant_id = :tenant_id
        RETURNING invoice_id
    """), {
        "status": body.status,
        "resolved_at": resolved_at,
        "notes": body.notes,
        "id": promise_id,
        "tenant_id": tenant_id,
    }).fetchone()

    if not row:
        raise HTTPException(404, "Promise not found")

    # If BROKEN → resume dunning, clear flag
    if body.status == "BROKEN":
        db.execute(text("""
            UPDATE uae_sales_invoices
            SET dunning_paused = FALSE,
                dunning_pause_until = NULL,
                has_open_promise = FALSE
            WHERE id = :invoice_id
        """), {"invoice_id": row[0]})

    # If KEPT → clear promise flag
    if body.status == "KEPT":
        db.execute(text("""
            UPDATE uae_sales_invoices
            SET has_open_promise = FALSE
            WHERE id = :invoice_id
        """), {"invoice_id": row[0]})

    db.commit()
    return {"ok": True, "message": f"Promise marked {body.status}"}


# ─── DISPUTES ──────────────────────────────────────────────

@router.get("/disputes")
def list_disputes(
    request: Request,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    sql = """
        SELECT d.*,
               i.status as invoice_status,
               i.outstanding,
               i.total_amount
        FROM ar_disputes d
        LEFT JOIN uae_sales_invoices i ON i.id = d.invoice_id
        WHERE d.tenant_id = :tenant_id
    """
    params: dict = {"tenant_id": tenant_id}

    if company_id:
        sql += " AND d.company_id = :company_id"
        params["company_id"] = company_id

    if status:
        sql += " AND d.status = :status"
        params["status"] = status

    sql += " ORDER BY d.created_at DESC"

    rows = db.execute(text(sql), params).mappings().all()
    return {"disputes": [dict(r) for r in rows], "total": len(rows)}


@router.post("/disputes")
def open_dispute(
    body: DisputeCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    dispute_id = str(uuid.uuid4())
    sla_deadline = date.today() + timedelta(days=body.sla_days)

    db.execute(text("""
        INSERT INTO ar_disputes
          (id, tenant_id, company_id, invoice_id, invoice_number,
           customer_name, reason, dispute_type, internal_owner,
           sla_deadline, dunning_paused, pause_until, status, created_at)
        VALUES
          (:id, :tenant_id, :company_id, :invoice_id, :invoice_number,
           :customer_name, :reason, :dispute_type, :internal_owner,
           :sla_deadline, TRUE, :sla_deadline, 'open', NOW())
    """), {
        "id": dispute_id,
        "tenant_id": tenant_id,
        "company_id": company_id,
        "invoice_id": body.invoice_id,
        "invoice_number": body.invoice_number,
        "customer_name": body.customer_name,
        "reason": body.reason,
        "dispute_type": body.dispute_type,
        "internal_owner": body.internal_owner,
        "sla_deadline": sla_deadline,
    })

    # Pause dunning on invoice
    db.execute(text("""
        UPDATE uae_sales_invoices
        SET dunning_paused = TRUE,
            dunning_pause_until = :sla_deadline,
            has_open_dispute = TRUE,
            last_reply_intent = 'DISPUTE',
            last_reply_date = CURRENT_DATE
        WHERE id = :invoice_id
    """), {"sla_deadline": sla_deadline, "invoice_id": body.invoice_id})

    db.commit()

    return {
        "ok": True,
        "dispute_id": dispute_id,
        "message": f"Dispute opened. Dunning paused until {sla_deadline}."
    }


@router.patch("/disputes/{dispute_id}/resolve")
def resolve_dispute(
    dispute_id: str,
    body: DisputeResolve,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)

    row = db.execute(text("""
        UPDATE ar_disputes
        SET status = 'resolved',
            resolution_notes = :notes,
            resolved_at = NOW()
        WHERE id = :id AND tenant_id = :tenant_id
        RETURNING invoice_id
    """), {
        "notes": body.resolution_notes,
        "id": dispute_id,
        "tenant_id": tenant_id,
    }).fetchone()

    if not row:
        raise HTTPException(404, "Dispute not found")

    # Resume dunning
    db.execute(text("""
        UPDATE uae_sales_invoices
        SET dunning_paused = FALSE,
            dunning_pause_until = NULL,
            has_open_dispute = FALSE
        WHERE id = :invoice_id
    """), {"invoice_id": row[0]})

    db.commit()
    return {"ok": True, "message": "Dispute resolved. Dunning resumed."}


# ─── HUMAN APPROVAL QUEUE ──────────────────────────────────

@router.get("/queue")
def list_queue(
    request: Request,
    status: str = "pending",
    queue_type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    sql = """
        SELECT q.*,
               i.status as invoice_status,
               i.outstanding,
               i.total_amount,
               i.last_dunning_level
        FROM ar_human_queue q
        LEFT JOIN uae_sales_invoices i ON i.id = q.invoice_id
        WHERE q.tenant_id = :tenant_id AND q.status = :status
    """
    params: dict = {"tenant_id": tenant_id, "status": status}

    if company_id:
        sql += " AND q.company_id = :company_id"
        params["company_id"] = company_id

    if queue_type:
        sql += " AND q.queue_type = :queue_type"
        params["queue_type"] = queue_type

    sql += " ORDER BY q.created_at ASC"

    rows = db.execute(text(sql), params).mappings().all()

    # Counts by type for badge
    counts_rows = db.execute(text("""
        SELECT queue_type, COUNT(*) as count
        FROM ar_human_queue
        WHERE tenant_id = :tenant_id AND status = 'pending'
        GROUP BY queue_type
    """), {"tenant_id": tenant_id}).mappings().all()

    counts = {r["queue_type"]: r["count"] for r in counts_rows}

    return {
        "items": [dict(r) for r in rows],
        "total_pending": sum(counts.values()),
        "counts_by_type": counts,
    }


@router.post("/queue")
def add_to_queue(
    body: QueueCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    item_id = str(uuid.uuid4())

    db.execute(text("""
        INSERT INTO ar_human_queue
          (id, tenant_id, company_id, invoice_id, invoice_number,
           customer_name, amount, currency, days_overdue, queue_type,
           drafted_content, agent_summary, confidence_score,
           status, created_at, expires_at)
        VALUES
          (:id, :tenant_id, :company_id, :invoice_id, :invoice_number,
           :customer_name, :amount, :currency, :days_overdue, :queue_type,
           :drafted_content, :agent_summary, :confidence_score,
           'pending', NOW(), NOW() + INTERVAL '7 days')
    """), {
        "id": item_id,
        "tenant_id": tenant_id,
        "company_id": company_id,
        "invoice_id": body.invoice_id,
        "invoice_number": body.invoice_number,
        "customer_name": body.customer_name,
        "amount": body.amount,
        "currency": body.currency,
        "days_overdue": body.days_overdue,
        "queue_type": body.queue_type,
        "drafted_content": body.drafted_content,
        "agent_summary": body.agent_summary,
        "confidence_score": body.confidence_score,
    })

    db.execute(text("""
        UPDATE uae_sales_invoices
        SET in_human_queue = TRUE
        WHERE id = :invoice_id
    """), {"invoice_id": body.invoice_id})

    db.commit()
    return {"ok": True, "item_id": item_id}


@router.post("/queue/{item_id}/action")
def action_queue_item(
    item_id: str,
    body: QueueAction,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)

    valid_actions = {"approved", "held", "rejected"}
    if body.action not in valid_actions:
        raise HTTPException(400, f"action must be one of {valid_actions}")

    row = db.execute(text("""
        UPDATE ar_human_queue
        SET status = :action,
            actioned_by = :actioned_by,
            actioned_at = NOW(),
            drafted_content = COALESCE(:edited_content, drafted_content)
        WHERE id = :id AND tenant_id = :tenant_id
        RETURNING invoice_id
    """), {
        "action": body.action,
        "actioned_by": body.actioned_by,
        "edited_content": body.edited_content,
        "id": item_id,
        "tenant_id": tenant_id,
    }).fetchone()

    if not row:
        raise HTTPException(404, "Queue item not found")

    # Check if any more pending items for this invoice
    remaining = db.execute(text("""
        SELECT COUNT(*) FROM ar_human_queue
        WHERE invoice_id = :invoice_id AND status = 'pending'
    """), {"invoice_id": row[0]}).scalar()

    if remaining == 0:
        db.execute(text("""
            UPDATE uae_sales_invoices
            SET in_human_queue = FALSE
            WHERE id = :invoice_id
        """), {"invoice_id": row[0]})

    db.commit()
    return {
        "ok": True,
        "message": f"Item {body.action}.",
    }


# ─── REPLY EVENTS ──────────────────────────────────────────

@router.post("/reply-events")
def log_reply_event(
    body: ReplyEventCreate,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    event_id = str(uuid.uuid4())

    db.execute(text("""
        INSERT INTO ar_reply_events
          (id, tenant_id, company_id, invoice_id, invoice_number,
           customer_name, customer_email, raw_snippet,
           classified_intent, confidence_score,
           extracted_date, extracted_reason, action_taken, created_at)
        VALUES
          (:id, :tenant_id, :company_id, :invoice_id, :invoice_number,
           :customer_name, :customer_email, :raw_snippet,
           :classified_intent, :confidence_score,
           :extracted_date, :extracted_reason, :action_taken, NOW())
    """), {
        "id": event_id,
        "tenant_id": tenant_id,
        "company_id": company_id,
        "invoice_id": body.invoice_id,
        "invoice_number": body.invoice_number,
        "customer_name": body.customer_name,
        "customer_email": body.customer_email,
        "raw_snippet": body.raw_snippet,
        "classified_intent": body.classified_intent,
        "confidence_score": body.confidence_score,
        "extracted_date": body.extracted_date,
        "extracted_reason": body.extracted_reason,
        "action_taken": body.action_taken,
    })

    # Update last reply intent on invoice
    if body.invoice_id:
        db.execute(text("""
            UPDATE uae_sales_invoices
            SET last_reply_intent = :intent,
                last_reply_date = CURRENT_DATE
            WHERE id = :invoice_id
        """), {"intent": body.classified_intent, "invoice_id": body.invoice_id})

    db.commit()
    return {"ok": True, "event_id": event_id}


# ─── DASHBOARD SUMMARY ─────────────────────────────────────

@router.get("/dashboard/summary")
def dashboard_summary(
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    params: dict = {"tenant_id": tenant_id}
    company_filter = ""
    if company_id:
        company_filter = "AND company_id = :company_id"
        params["company_id"] = company_id

    row = db.execute(text(f"""
        SELECT
          (SELECT COUNT(*) FROM ar_human_queue
           WHERE tenant_id = :tenant_id {company_filter}
           AND status = 'pending') as queue_pending,

          (SELECT COUNT(*) FROM ar_promises
           WHERE tenant_id = :tenant_id {company_filter}
           AND status = 'OPEN'
           AND promised_date = CURRENT_DATE) as promises_due_today,

          (SELECT COUNT(*) FROM ar_disputes
           WHERE tenant_id = :tenant_id {company_filter}
           AND status = 'open'
           AND sla_deadline < CURRENT_DATE) as disputes_breaching_sla,

          (SELECT COUNT(*) FROM ar_disputes
           WHERE tenant_id = :tenant_id {company_filter}
           AND status = 'open') as disputes_open,

          (SELECT COUNT(*) FROM ar_promises
           WHERE tenant_id = :tenant_id {company_filter}
           AND status = 'BROKEN'
           AND resolved_at > NOW() - INTERVAL '7 days') as broken_promises_week
    """), params).mappings().fetchone()

    return dict(row)


# ─── ANALYTICS ─────────────────────────────────────────────

@router.get("/analytics")
def ar_analytics(
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    params: dict = {"tenant_id": tenant_id}
    company_filter = ""
    if company_id:
        company_filter = "AND company_id = :company_id"
        params["company_id"] = company_id

    # DSO + Collected MTD
    kpi = db.execute(text(f"""
        SELECT
          COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled')
            THEN outstanding ELSE 0 END), 0) as total_outstanding,
          COALESCE(SUM(CASE WHEN status = 'paid'
            AND updated_at > NOW() - INTERVAL '30 days'
            THEN total_amount ELSE 0 END), 0) as sales_30d,
          COALESCE(SUM(CASE WHEN status = 'paid'
            AND updated_at >= DATE_TRUNC('month', NOW())
            THEN total_amount ELSE 0 END), 0) as collected_mtd
        FROM uae_sales_invoices
        WHERE tenant_id = :tenant_id {company_filter}
    """), params).mappings().fetchone()

    sales_30d = float(kpi["sales_30d"]) or 1
    dso = round((float(kpi["total_outstanding"]) / sales_30d) * 30)

    # Aging buckets
    aging = db.execute(text(f"""
        SELECT
          CASE
            WHEN CURRENT_DATE - due_date BETWEEN 1 AND 30 THEN '1-30'
            WHEN CURRENT_DATE - due_date BETWEEN 31 AND 60 THEN '31-60'
            WHEN CURRENT_DATE - due_date BETWEEN 61 AND 90 THEN '61-90'
            WHEN CURRENT_DATE - due_date > 90 THEN '90+'
            ELSE 'Current'
          END as bucket,
          SUM(outstanding) as amount,
          COUNT(*) as count
        FROM uae_sales_invoices
        WHERE tenant_id = :tenant_id {company_filter}
          AND status NOT IN ('paid','cancelled')
        GROUP BY bucket
        ORDER BY CASE bucket
          WHEN '1-30' THEN 1 WHEN '31-60' THEN 2
          WHEN '61-90' THEN 3 WHEN '90+' THEN 4 ELSE 0 END
    """), params).mappings().all()

    # Weekly trend last 8 weeks
    trend = db.execute(text(f"""
        SELECT
          TO_CHAR(DATE_TRUNC('week', created_at), 'DD Mon') as week,
          SUM(CASE WHEN status NOT IN ('paid','cancelled')
            THEN outstanding ELSE 0 END) as outstanding,
          SUM(CASE WHEN status = 'paid'
            THEN total_amount ELSE 0 END) as collected,
          CASE
            WHEN SUM(outstanding) + SUM(CASE WHEN status='paid'
              THEN total_amount ELSE 0 END) > 0
            THEN ROUND(
              SUM(CASE WHEN status='paid' THEN total_amount ELSE 0 END) /
              NULLIF(SUM(outstanding) + SUM(CASE WHEN status='paid'
                THEN total_amount ELSE 0 END), 0) * 100, 1)
            ELSE 0
          END as cei
        FROM uae_sales_invoices
        WHERE tenant_id = :tenant_id {company_filter}
          AND created_at > NOW() - INTERVAL '8 weeks'
        GROUP BY DATE_TRUNC('week', created_at)
        ORDER BY DATE_TRUNC('week', created_at) ASC
    """), params).mappings().all()

    # Days to collect by segment
    segments = db.execute(text(f"""
        SELECT
          COALESCE(customer_tag, 'STANDARD') as segment,
          ROUND(AVG(
            CASE WHEN status = 'paid' AND paid_date IS NOT NULL
            THEN paid_date - due_date
            ELSE CURRENT_DATE - due_date END
          )) as days_to_collect,
          SUM(CASE WHEN status NOT IN ('paid','cancelled')
            THEN outstanding ELSE 0 END) as outstanding
        FROM uae_sales_invoices
        WHERE tenant_id = :tenant_id {company_filter}
          AND due_date IS NOT NULL
        GROUP BY COALESCE(customer_tag, 'STANDARD')
        ORDER BY days_to_collect DESC NULLS LAST
    """), params).mappings().all()

    return {
        "dso": max(0, dso),
        "collected_mtd": float(kpi["collected_mtd"]),
        "total_outstanding": float(kpi["total_outstanding"]),
        "aging_buckets": [dict(r) for r in aging],
        "weekly_trend": [dict(r) for r in trend],
        "segment_data": [dict(r) for r in segments],
    }


# ─── COLLECTIONS BOARD ─────────────────────────────────────

@router.get("/collections-board")
def collections_board(
    request: Request,
    sort: str = "total_outstanding",
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    valid_sorts = {
        "total_outstanding": "total_outstanding DESC",
        "total_overdue": "total_overdue DESC",
        "days_overdue_max": "days_overdue_max DESC",
    }
    order = valid_sorts.get(sort, "total_outstanding DESC")

    params: dict = {"tenant_id": tenant_id}
    company_filter = ""
    if company_id:
        company_filter = "AND company_id = :company_id"
        params["company_id"] = company_id

    rows = db.execute(text(f"""
        SELECT
          customer_id,
          MAX(customer_tag) as customer_tag,
          CASE
            WHEN MAX(CASE WHEN status NOT IN ('paid','cancelled')
              THEN CURRENT_DATE - due_date ELSE 0 END) > 90 THEN 'critical'
            WHEN MAX(CASE WHEN status NOT IN ('paid','cancelled')
              THEN CURRENT_DATE - due_date ELSE 0 END) > 60 THEN 'high'
            WHEN MAX(CASE WHEN status NOT IN ('paid','cancelled')
              THEN CURRENT_DATE - due_date ELSE 0 END) > 30 THEN 'medium'
            ELSE 'low'
          END as risk_tier,
          COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled')
            THEN outstanding ELSE 0 END), 0) as total_outstanding,
          COALESCE(SUM(CASE WHEN status NOT IN ('paid','cancelled')
            AND CURRENT_DATE > due_date
            THEN outstanding ELSE 0 END), 0) as total_overdue,
          MAX(CASE WHEN status NOT IN ('paid','cancelled')
            THEN CURRENT_DATE - due_date ELSE 0 END) as days_overdue_max,
          COUNT(CASE WHEN status NOT IN ('paid','cancelled') THEN 1 END) as open_invoices,
          MAX(last_reply_intent) as last_reply_intent,
          MAX(last_reply_date) as last_reply_date,
          BOOL_OR(has_open_promise) as has_open_promise,
          BOOL_OR(has_open_dispute) as has_open_dispute,
          BOOL_OR(in_human_queue) as in_human_queue
        FROM uae_sales_invoices
        WHERE tenant_id = :tenant_id {company_filter}
          AND customer_id IS NOT NULL
        GROUP BY customer_id
        HAVING SUM(CASE WHEN status NOT IN ('paid','cancelled')
          THEN outstanding ELSE 0 END) > 0
        ORDER BY {order}
    """), params).mappings().all()

    return {"customers": [dict(r) for r in rows]}


@router.patch("/customer-tag")
def update_customer_tag(
    body: CustomerTagUpdate,
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)
    company_id = _cid(request)

    valid_tags = {"KEY", "RISK", "NEW", "SILENT", None}
    tag = body.tag if body.tag in valid_tags else None

    params: dict = {
        "tag": tag,
        "tenant_id": tenant_id,
        "customer_name": body.customer_name,
    }
    company_filter = ""
    if company_id:
        company_filter = "AND company_id = :company_id"
        params["company_id"] = company_id

    db.execute(text(f"""
        UPDATE uae_sales_invoices
        SET customer_tag = :tag
        WHERE tenant_id = :tenant_id {company_filter}
          AND customer_id IN (
            SELECT id FROM uae_customers
            WHERE name ILIKE :customer_name
            LIMIT 1
          )
          AND status NOT IN ('paid','cancelled')
    """), params)

    db.commit()
    return {"ok": True, "message": f"Tag updated to {tag}"}


# ─── CRON: Check broken promises ───────────────────────────

@router.post("/cron/check-promises")
def cron_check_promises(
    request: Request,
    db: Session = Depends(get_db),
):
    tenant_id = _tid(request)

    # Mark broken
    broken = db.execute(text("""
        UPDATE ar_promises
        SET status = 'BROKEN', resolved_at = NOW()
        WHERE status = 'OPEN'
          AND promised_date < CURRENT_DATE
          AND tenant_id = :tenant_id
        RETURNING invoice_id
    """), {"tenant_id": tenant_id}).rowcount

    # Resume dunning for broken promises with no open dispute
    resumed = db.execute(text("""
        UPDATE uae_sales_invoices
        SET dunning_paused = FALSE,
            dunning_pause_until = NULL,
            has_open_promise = FALSE
        WHERE tenant_id = :tenant_id
          AND dunning_paused = TRUE
          AND has_open_dispute = FALSE
          AND has_open_promise = TRUE
          AND dunning_pause_until < CURRENT_DATE
        RETURNING id
    """), {"tenant_id": tenant_id}).rowcount

    db.commit()

    return {
        "ok": True,
        "broken_promises": broken,
        "dunning_resumed": resumed,
    }
