"""Lightweight CRM API — contacts, deals, activities, quotes, pipeline."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.crm import CRMActivity, CRMContact, CRMDeal, CRMQuote
from app.models.uae_accounting_full import UAESalesInvoice
from app.services.credit_risk_service import calculate_credit_score, credit_risk_summary

router = APIRouter(prefix="/api/crm", tags=["CRM"])

CRM_STAGES = ["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"]
OPEN_STAGES = ["New", "Qualified", "Proposal", "Negotiation"]


def _ws(request: Request, workspace_id: Optional[str] = None) -> str:
    return (
        workspace_id
        or request.headers.get("x-workspace-id")
        or request.headers.get("x-tenant-id")
        or "demo"
    )


def _company_id(request: Request, query_company: Optional[str] = None, body_company: Optional[str] = None) -> Optional[str]:
    return body_company or query_company or request.query_params.get("company_id")


def _contact_dict(c: CRMContact) -> dict[str, Any]:
    return {
        "id": c.id,
        "name": c.name,
        "company_name": c.company_name,
        "email": c.email,
        "phone": c.phone,
        "contact_type": c.contact_type or "Lead",
        "source": c.source,
        "assigned_to": c.assigned_to,
        "notes": c.notes,
        "credit_score": float(c.credit_score) if c.credit_score is not None else None,
        "risk_category": c.risk_category,
        "credit_limit_aed": float(c.credit_limit_aed) if c.credit_limit_aed is not None else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _deal_dict(d: CRMDeal, contact: CRMContact | None = None) -> dict[str, Any]:
    return {
        "id": d.id,
        "deal_name": d.deal_name,
        "contact_id": d.contact_id,
        "contact_name": contact.name if contact else None,
        "company_name": contact.company_name if contact else None,
        "value_aed": float(d.value_aed or 0),
        "currency": d.currency or "AED",
        "stage": d.stage or "New",
        "expected_close_date": str(d.expected_close_date) if d.expected_close_date else None,
        "probability_pct": int(d.probability_pct or 0),
        "notes": d.notes,
        "ar_invoice_id": d.ar_invoice_id,
    }


def _activity_dict(a: CRMActivity) -> dict[str, Any]:
    return {
        "id": a.id,
        "deal_id": a.deal_id,
        "contact_id": a.contact_id,
        "activity_type": a.activity_type or "follow-up",
        "subject": a.subject or "",
        "notes": a.notes,
        "due_date": str(a.due_date) if a.due_date else None,
        "completed": bool(a.completed),
        "created_by": a.created_by,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _quote_dict(q: CRMQuote) -> dict[str, Any]:
    return {
        "id": q.id,
        "quote_number": q.quote_number or "",
        "deal_id": q.deal_id,
        "contact_id": q.contact_id,
        "line_items": q.line_items or [],
        "subtotal": float(q.subtotal or 0),
        "vat_amount": float(q.vat_amount or 0),
        "total_aed": float(q.total_aed or 0),
        "status": q.status or "Draft",
        "valid_until": str(q.valid_until) if q.valid_until else None,
        "ar_invoice_id": q.ar_invoice_id,
    }


def _contacts_map(db: Session, contact_ids: set[str]) -> dict[str, CRMContact]:
    if not contact_ids:
        return {}
    rows = db.query(CRMContact).filter(CRMContact.id.in_(list(contact_ids))).all()
    return {r.id: r for r in rows}


def _month_bounds(today: date) -> tuple[date, date]:
    start = today.replace(day=1)
    if start.month == 12:
        end = date(start.year, 12, 31)
    else:
        end = date(start.year, start.month + 1, 1) - timedelta(days=1)
    return start, end


class WorkspaceBody(BaseModel):
    workspace_id: Optional[str] = None
    company_id: Optional[str] = None


class ContactCreateIn(WorkspaceBody):
    name: str
    company_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    contact_type: str = "Lead"
    source: Optional[str] = None
    assigned_to: Optional[str] = None
    notes: Optional[str] = None


class DealCreateIn(WorkspaceBody):
    deal_name: str
    contact_id: Optional[str] = None
    value_aed: float = 0
    currency: str = "AED"
    stage: str = "New"
    expected_close_date: Optional[str] = None
    probability_pct: int = 10
    notes: Optional[str] = None


class DealPatchIn(BaseModel):
    stage: Optional[str] = None
    deal_name: Optional[str] = None
    value_aed: Optional[float] = None
    expected_close_date: Optional[str] = None
    probability_pct: Optional[int] = None
    notes: Optional[str] = None


class ActivityCreateIn(WorkspaceBody):
    subject: str
    activity_type: str = "follow-up"
    deal_id: Optional[str] = None
    contact_id: Optional[str] = None
    due_date: Optional[str] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None


class QuoteLineIn(BaseModel):
    description: str
    qty: float = 1.0
    unit_price: float
    vat_rate: float = 5.0


class QuoteCreateIn(WorkspaceBody):
    line_items: list[QuoteLineIn]
    deal_id: Optional[str] = None
    contact_id: Optional[str] = None
    valid_until: Optional[str] = None


def _next_quote_number(db: Session, workspace_id: str, company_id: Optional[str]) -> str:
    year = datetime.utcnow().year
    q = db.query(CRMQuote).filter(CRMQuote.workspace_id == workspace_id)
    if company_id:
        q = q.filter(CRMQuote.company_id == company_id)
    return f"QTE-{year}-{q.count() + 1:04d}"


def _quote_totals(line_items: list[QuoteLineIn]) -> tuple[float, float, float]:
    subtotal = sum(li.qty * li.unit_price for li in line_items)
    vat_amount = sum(li.qty * li.unit_price * (li.vat_rate / 100.0 if li.vat_rate > 1 else li.vat_rate) for li in line_items)
    return subtotal, vat_amount, subtotal + vat_amount



@router.get("/dashboard")
def crm_dashboard(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    cq = db.query(CRMContact).filter(CRMContact.workspace_id == ws)
    dq = db.query(CRMDeal).filter(CRMDeal.workspace_id == ws)
    aq = db.query(CRMActivity).filter(CRMActivity.workspace_id == ws)
    if cid:
        cq = cq.filter(CRMContact.company_id == cid)
        dq = dq.filter(CRMDeal.company_id == cid)
    contacts = cq.all()
    deals = dq.all()
    today = date.today()
    month_start, month_end = _month_bounds(today)
    total_leads = sum(1 for c in contacts if (c.contact_type or "").lower() in ("lead", "prospect"))
    open_deals = [d for d in deals if d.stage in OPEN_STAGES]
    pipeline_value = sum(float(d.value_aed or 0) for d in open_deals)
    won_this_month = [
        d for d in deals
        if d.stage == "Won" and d.updated_at and month_start <= d.updated_at.date() <= month_end
    ]
    won_value = sum(float(d.value_aed or 0) for d in won_this_month)
    revenue_crm = 0.0
    for d in won_this_month:
        if d.ar_invoice_id:
            inv = db.query(UAESalesInvoice).filter_by(id=d.ar_invoice_id).first()
            if inv:
                revenue_crm += float(inv.total_amount or 0)
    overdue_activities = aq.filter(
        CRMActivity.completed.is_(False),
        CRMActivity.due_date.isnot(None),
        CRMActivity.due_date < today,
    ).count()
    return {
        "total_leads": total_leads,
        "total_deals": len(deals),
        "open_deals": len(open_deals),
        "pipeline_value_aed": round(pipeline_value, 2),
        "deals_won_this_month": len(won_this_month),
        "deals_won_value_aed": round(won_value, 2),
        "revenue_from_crm_this_month": round(revenue_crm, 2),
        "overdue_activities_count": overdue_activities,
    }


@router.get("/pipeline")
def crm_pipeline(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    q = db.query(CRMDeal).filter(CRMDeal.workspace_id == ws)
    if cid:
        q = q.filter(CRMDeal.company_id == cid)
    deals = q.all()
    contact_ids = {d.contact_id for d in deals if d.contact_id}
    cmap = _contacts_map(db, contact_ids)
    stages: dict[str, dict[str, Any]] = {}
    pipeline_value = 0.0
    for stage in CRM_STAGES:
        stage_deals = [d for d in deals if d.stage == stage]
        total_val = sum(float(d.value_aed or 0) for d in stage_deals)
        if stage in OPEN_STAGES:
            pipeline_value += total_val
        stages[stage] = {
            "stage": stage,
            "deal_count": len(stage_deals),
            "total_value_aed": round(total_val, 2),
            "deals": [_deal_dict(d, cmap.get(d.contact_id)) for d in stage_deals],
        }
    return {"stages": stages, "pipeline_value_aed": round(pipeline_value, 2)}


@router.get("/contacts")
def list_contacts(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    search: Optional[str] = None,
    type: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    q = db.query(CRMContact).filter(CRMContact.workspace_id == ws)
    if cid:
        q = q.filter(CRMContact.company_id == cid)
    if type:
        q = q.filter(CRMContact.contact_type == type)
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(
            or_(
                CRMContact.name.ilike(like),
                CRMContact.company_name.ilike(like),
                CRMContact.email.ilike(like),
            )
        )
    q = q.order_by(CRMContact.created_at.desc())
    return {"contacts": [_contact_dict(c) for c in q.all()]}


@router.post("/contacts")
def create_contact(body: ContactCreateIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    cid = _company_id(request, body_company=body.company_id)
    if not body.name.strip():
        raise HTTPException(status_code=400, detail="name is required")
    contact = CRMContact(
        id=str(uuid.uuid4()),
        workspace_id=ws,
        company_id=cid,
        name=body.name.strip(),
        company_name=body.company_name,
        email=body.email,
        phone=body.phone,
        contact_type=body.contact_type or "Lead",
        source=body.source,
        assigned_to=body.assigned_to,
        notes=body.notes,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return _contact_dict(contact)


@router.get("/deals")
def list_deals(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    stage: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    q = db.query(CRMDeal).filter(CRMDeal.workspace_id == ws)
    if cid:
        q = q.filter(CRMDeal.company_id == cid)
    if stage:
        q = q.filter(CRMDeal.stage == stage)
    deals = q.order_by(CRMDeal.updated_at.desc()).all()
    cmap = _contacts_map(db, {d.contact_id for d in deals if d.contact_id})
    return {"deals": [_deal_dict(d, cmap.get(d.contact_id)) for d in deals]}


@router.post("/deals")
def create_deal(body: DealCreateIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    cid = _company_id(request, body_company=body.company_id)
    if not body.deal_name.strip():
        raise HTTPException(status_code=400, detail="deal_name is required")
    if body.contact_id:
        contact = (
            db.query(CRMContact)
            .filter(CRMContact.id == body.contact_id, CRMContact.workspace_id == ws)
            .first()
        )
        if not contact:
            raise HTTPException(status_code=404, detail="Contact not found")
    close_date = date.fromisoformat(body.expected_close_date) if body.expected_close_date else None
    deal = CRMDeal(
        id=str(uuid.uuid4()),
        workspace_id=ws,
        company_id=cid,
        contact_id=body.contact_id,
        deal_name=body.deal_name.strip(),
        value_aed=body.value_aed,
        currency=body.currency or "AED",
        stage=body.stage if body.stage in CRM_STAGES else "New",
        expected_close_date=close_date,
        probability_pct=body.probability_pct,
        notes=body.notes,
    )
    db.add(deal)
    db.commit()
    db.refresh(deal)
    contact = db.query(CRMContact).filter_by(id=deal.contact_id).first() if deal.contact_id else None
    return _deal_dict(deal, contact)


@router.patch("/deals/{deal_id}")
def update_deal(deal_id: str, body: DealPatchIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, None)
    deal = db.query(CRMDeal).filter(CRMDeal.id == deal_id, CRMDeal.workspace_id == ws).first()
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    if body.stage is not None:
        if body.stage not in CRM_STAGES:
            raise HTTPException(status_code=400, detail="Invalid stage")
        deal.stage = body.stage
    if body.deal_name is not None:
        deal.deal_name = body.deal_name
    if body.value_aed is not None:
        deal.value_aed = body.value_aed
    if body.expected_close_date is not None:
        deal.expected_close_date = date.fromisoformat(body.expected_close_date) if body.expected_close_date else None
    if body.probability_pct is not None:
        deal.probability_pct = body.probability_pct
    if body.notes is not None:
        deal.notes = body.notes
    deal.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(deal)
    contact = db.query(CRMContact).filter_by(id=deal.contact_id).first() if deal.contact_id else None
    return _deal_dict(deal, contact)


@router.get("/activities")
def list_activities(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    deal_id: Optional[str] = None,
    contact_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    q = db.query(CRMActivity).filter(CRMActivity.workspace_id == ws)
    if deal_id:
        q = q.filter(CRMActivity.deal_id == deal_id)
    if contact_id:
        q = q.filter(CRMActivity.contact_id == contact_id)
    q = q.order_by(CRMActivity.created_at.desc())
    return {"activities": [_activity_dict(a) for a in q.all()]}


@router.post("/activities")
def create_activity(body: ActivityCreateIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    if not body.subject.strip():
        raise HTTPException(status_code=400, detail="subject is required")
    due = date.fromisoformat(body.due_date) if body.due_date else None
    activity = CRMActivity(
        id=str(uuid.uuid4()),
        workspace_id=ws,
        deal_id=body.deal_id,
        contact_id=body.contact_id,
        activity_type=body.activity_type or "follow-up",
        subject=body.subject.strip(),
        notes=body.notes,
        due_date=due,
        completed=False,
        created_by=body.created_by,
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return _activity_dict(activity)


@router.get("/quotes")
def list_quotes(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    q = db.query(CRMQuote).filter(CRMQuote.workspace_id == ws)
    if cid:
        q = q.filter(CRMQuote.company_id == cid)
    q = q.order_by(CRMQuote.created_at.desc())
    return {"quotes": [_quote_dict(qt) for qt in q.all()]}


@router.post("/quotes")
def create_quote(body: QuoteCreateIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    cid = _company_id(request, body_company=body.company_id)
    if not body.line_items:
        raise HTTPException(status_code=400, detail="line_items required")
    subtotal, vat_amount, total = _quote_totals(body.line_items)
    valid_until = date.fromisoformat(body.valid_until) if body.valid_until else None
    quote = CRMQuote(
        id=str(uuid.uuid4()),
        workspace_id=ws,
        company_id=cid,
        deal_id=body.deal_id,
        contact_id=body.contact_id,
        quote_number=_next_quote_number(db, ws, cid),
        line_items=[li.model_dump() for li in body.line_items],
        subtotal=subtotal,
        vat_amount=vat_amount,
        total_aed=total,
        status="Draft",
        valid_until=valid_until,
    )
    db.add(quote)
    db.commit()
    db.refresh(quote)
    return _quote_dict(quote)


@router.post("/quotes/{quote_id}/convert-to-invoice")
def convert_quote_to_invoice(
    quote_id: str,
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    from app.api.routes.uae_ar_routes import CreateInvoiceIn, LineItemIn, create_invoice

    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    quote = (
        db.query(CRMQuote)
        .filter(CRMQuote.id == quote_id, CRMQuote.workspace_id == ws)
        .first()
    )
    if not quote:
        raise HTTPException(status_code=404, detail="Quote not found")
    if quote.ar_invoice_id:
        raise HTTPException(status_code=400, detail="Quote already converted")
    if not cid:
        raise HTTPException(status_code=400, detail="company_id required")

    contact = None
    if quote.contact_id:
        contact = db.query(CRMContact).filter_by(id=quote.contact_id).first()
    customer_name = (contact.company_name or contact.name) if contact else "Customer"

    today = date.today()
    due = quote.valid_until or (today + timedelta(days=30))
    line_items = [
        LineItemIn(
            description=li.get("description", "Item"),
            qty=float(li.get("qty", 1)),
            unit_price=float(li.get("unit_price", 0)),
            vat_rate=float(li.get("vat_rate", 5)),
        )
        for li in (quote.line_items or [])
    ]
    if not line_items:
        raise HTTPException(status_code=400, detail="Quote has no line items")

    payload = CreateInvoiceIn(
        customer_name=customer_name,
        invoice_date=today.isoformat(),
        due_date=due.isoformat() if isinstance(due, date) else str(due),
        line_items=line_items,
        company_id=cid,
        workspace_id=ws,
    )
    result = create_invoice(payload, request, db)

    quote.status = "Accepted"
    quote.ar_invoice_id = result["invoice_id"]
    db.add(quote)

    if quote.deal_id:
        deal = db.query(CRMDeal).filter_by(id=quote.deal_id).first()
        if deal:
            deal.ar_invoice_id = result["invoice_id"]
            deal.stage = "Won"
            deal.updated_at = datetime.utcnow()
            db.add(deal)

    db.commit()
    return {
        "invoice_id": result["invoice_id"],
        "invoice_number": result["invoice_number"],
        "total": result["total"],
    }


@router.post("/contacts/{contact_id}/credit-score")
def contact_credit_score(
    contact_id: str,
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    contact = (
        db.query(CRMContact)
        .filter(CRMContact.id == contact_id, CRMContact.workspace_id == ws)
        .first()
    )
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    result = calculate_credit_score(db, contact, tenant_id=ws, company_id=cid, persist=True)
    db.commit()
    return result


@router.get("/credit-risk-summary")
def get_credit_risk_summary(
    request: Request,
    workspace_id: Optional[str] = None,
    company_id: Optional[str] = None,
    db: Session = Depends(get_db),
):
    ws = _ws(request, workspace_id)
    cid = _company_id(request, company_id)
    return credit_risk_summary(db, ws, cid)


class RecalcCreditIn(BaseModel):
    workspace_id: Optional[str] = None
    company_id: Optional[str] = None


@router.post("/credit-risk/recalculate-all")
def recalculate_all_credit_risk(body: RecalcCreditIn, request: Request, db: Session = Depends(get_db)):
    ws = _ws(request, body.workspace_id)
    cid = _company_id(request, body_company=body.company_id)
    return credit_risk_summary(db, ws, cid)
