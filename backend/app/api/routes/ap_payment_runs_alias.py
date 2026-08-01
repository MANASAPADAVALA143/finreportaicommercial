"""Spec alias — /api/ap/payment-runs → same handlers as /api/ap-invoices/payment-run."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import ap_payment_run_routes as pr

router = APIRouter(prefix="/api/ap/payment-runs", tags=["AP Payment Runs"])

router.add_api_route("", pr.list_payment_runs, methods=["GET"])
router.add_api_route("/eligible", pr.list_eligible, methods=["GET"])
router.add_api_route("/stats/monthly", pr.payment_run_monthly_stats, methods=["GET"])
router.add_api_route("", pr.create_payment_run, methods=["POST"])
router.add_api_route("/{run_id}", pr.get_payment_run, methods=["GET"])
router.add_api_route("/{run_id}/submit", pr.submit_payment_run, methods=["POST"])
router.add_api_route("/{run_id}/approve", pr.approve_payment_run, methods=["POST"])
router.add_api_route("/{run_id}/reject", pr.reject_payment_run, methods=["POST"])
router.add_api_route("/{run_id}/cancel", pr.cancel_payment_run, methods=["POST"])
router.add_api_route("/{run_id}/execute", pr.execute_payment_run, methods=["POST"])
router.add_api_route("/{run_id}/bank-file", pr.download_bank_file, methods=["GET"])
router.add_api_route("/{run_id}/remittance", pr.download_remittance, methods=["GET"])
