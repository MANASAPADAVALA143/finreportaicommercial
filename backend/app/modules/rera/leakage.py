"""Revenue leakage detection — milestone-triggered billing scan.

NOTE: the original Emergent/MongoDB `routers/leakage.py` this was meant to be
ported from was not available in this environment (searched the full local
Desktop tree, including the standalone "RERA OS UAE" repo, which turned out
to be an unrelated, larger real-estate platform with no leakage module at
all). This is a reconstruction from the documented function names/behaviour
in the migration spec, using SQLAlchemy against `rera_webhook_events` /
`rera_bookings` / `rera_payments` instead of Motor/MongoDB. If a copy of the
original file turns up, diff it against this module and adjust.

Logic: a construction-progress / milestone webhook event ("trigger") for a
booking's SPA should be followed, within `window_days`, by an installment
receipt covering that milestone's scheduled amount. A trigger with no
matching receipt inside the window is flagged as at-risk revenue leakage.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal
from difflib import SequenceMatcher

from sqlalchemy.orm import Session

from app.models.rera import RERABooking, RERAPayment, RERAProject, RERAWebhookEvent

MILESTONE_EVENT_TYPES = {"construction.progress", "milestone.event"}
BILLING_EVENT_TYPES = {"invoice.created", "payment.received", "billing.issued"}


def _events_by_spa(
    db: Session, *, workspace_id: str | None = None, spa_id: str | None = None
) -> dict[str, list[RERAWebhookEvent]]:
    q = db.query(RERAWebhookEvent).filter(RERAWebhookEvent.is_dlq.is_(False))
    if workspace_id:
        q = q.filter(RERAWebhookEvent.workspace_id == workspace_id)
    if spa_id:
        q = q.filter(RERAWebhookEvent.spa_id == spa_id)
    out: dict[str, list[RERAWebhookEvent]] = {}
    for ev in q.order_by(RERAWebhookEvent.event_timestamp.asc()).all():
        out.setdefault(ev.spa_id, []).append(ev)
    return out


def _milestone_triggers(events: list[RERAWebhookEvent]) -> list[RERAWebhookEvent]:
    return [e for e in events if (e.event_type or "") in MILESTONE_EVENT_TYPES]


def _billing_signal_ts(events: list[RERAWebhookEvent], *, after: datetime, window_days: int) -> datetime | None:
    """Latest billing-type event timestamp within [after, after + window_days]."""
    window_end = after + timedelta(days=window_days)
    candidates = [
        e.event_timestamp
        for e in events
        if (e.event_type or "") in BILLING_EVENT_TYPES
        and e.event_timestamp is not None
        and after <= e.event_timestamp <= window_end
    ]
    return max(candidates) if candidates else None


def _latest_payment_schedule(booking: RERABooking) -> list[dict]:
    return list(booking.payment_schedule or [])


def _all_installment_receipts(db: Session, booking_id: str) -> list[RERAPayment]:
    return (
        db.query(RERAPayment)
        .filter(RERAPayment.booking_id == booking_id)
        .order_by(RERAPayment.payment_date.asc())
        .all()
    )


def _match_milestone_index(schedule: list[dict], event: RERAWebhookEvent) -> int | None:
    """Best-effort match of a webhook milestone event to a payment_schedule row by name.

    Returns the row's position in `schedule` (not the row itself) so the
    caller can sum everything scheduled up to and including this milestone.
    """
    if not schedule:
        return None
    label = str((event.data or {}).get("milestone") or (event.data or {}).get("name") or "").strip().lower()
    if not label:
        return 0
    best_idx, best_score = 0, 0.0
    for idx, row in enumerate(schedule):
        candidate = str(row.get("milestone") or "").strip().lower()
        score = SequenceMatcher(None, label, candidate).ratio()
        if score > best_score:
            best_idx, best_score = idx, score
    return best_idx


@dataclass
class LeakageItem:
    spa_id: str
    project_id: str
    booking_id: str
    milestone: str
    triggered_at: str
    amount_at_risk: float
    window_days: int
    reason: str = "milestone reached but no billing signal within window"


@dataclass
class LeakageScanResult:
    window_days: int
    flagged_count: int = 0
    total_at_risk: float = 0.0
    items: list[LeakageItem] = field(default_factory=list)


def scan_leakage(
    db: Session,
    *,
    workspace_id: str | None = None,
    window_days: int = 14,
    spa_id: str | None = None,
) -> LeakageScanResult:
    result = LeakageScanResult(window_days=window_days)
    events_by_spa = _events_by_spa(db, workspace_id=workspace_id, spa_id=spa_id)
    if not events_by_spa:
        return result

    bookings = (
        db.query(RERABooking)
        .filter(RERABooking.spa_id.in_(list(events_by_spa.keys())))
        .all()
    )
    booking_by_spa = {b.spa_id: b for b in bookings if b.spa_id}

    for spa, events in events_by_spa.items():
        booking = booking_by_spa.get(spa)
        if booking is None:
            continue
        if workspace_id:
            project = db.get(RERAProject, booking.project_id)
            if project is None or project.workspace_id != workspace_id:
                continue

        schedule = _latest_payment_schedule(booking)
        receipts = _all_installment_receipts(db, booking.id)

        for trigger in _milestone_triggers(events):
            if trigger.event_timestamp is None:
                continue
            billed_ts = _billing_signal_ts(events, after=trigger.event_timestamp, window_days=window_days)
            if billed_ts is not None:
                continue

            milestone_idx = _match_milestone_index(schedule, trigger)
            if milestone_idx is None:
                continue

            # Everything scheduled up to and including this milestone should
            # have been collected by the end of the window.
            expected_cumulative = sum(
                (Decimal(str(row.get("amount", 0))) for row in schedule[: milestone_idx + 1]), Decimal("0")
            )
            window_end = (trigger.event_timestamp + timedelta(days=window_days)).date()
            received_cumulative = sum(
                (
                    Decimal(str(r.gross_amount or 0))
                    for r in receipts
                    if r.payment_date is not None and r.payment_date <= window_end
                ),
                Decimal("0"),
            )
            at_risk = expected_cumulative - received_cumulative
            if at_risk <= 0:
                continue

            result.items.append(
                LeakageItem(
                    spa_id=spa,
                    project_id=booking.project_id,
                    booking_id=booking.id,
                    milestone=str(schedule[milestone_idx].get("milestone") or "unmatched"),
                    triggered_at=trigger.event_timestamp.isoformat(),
                    amount_at_risk=float(at_risk),
                    window_days=window_days,
                )
            )
            result.flagged_count += 1
            result.total_at_risk += float(at_risk)

    return result


def leakage_to_csv(result: LeakageScanResult) -> str:
    import csv
    import io

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(
        ["spa_id", "project_id", "booking_id", "milestone", "triggered_at", "amount_at_risk", "window_days", "reason"]
    )
    for item in result.items:
        writer.writerow(
            [
                item.spa_id,
                item.project_id,
                item.booking_id,
                item.milestone,
                item.triggered_at,
                item.amount_at_risk,
                item.window_days,
                item.reason,
            ]
        )
    return buf.getvalue()
