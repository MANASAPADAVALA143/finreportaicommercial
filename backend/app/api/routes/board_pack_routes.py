"""Public board pack PDF download / preview (token-based)."""
from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.ifrs_statement import BoardPack, BoardPackStatus
from app.services.board_pack_data import build_board_pack_data
from app.services.board_pack_generator import BoardPackGenerator, count_pdf_pages

router = APIRouter(tags=["board-pack"])


def tenant_id_header(x_tenant_id: Optional[str] = Header(None, alias="X-Tenant-ID")) -> str:
    return (x_tenant_id or "default").strip() or "default"


def _board_pack_dir() -> Path:
    return Path(__file__).resolve().parents[3] / "board_packs"


def _increment_view(db: Session, bp: BoardPack) -> None:
    bp.view_count = int(bp.view_count or 0) + 1
    db.commit()


@router.get("/download/{token}")
def download_board_pack(token: str, db: Session = Depends(get_db)):
    bp = db.query(BoardPack).filter(BoardPack.public_token == token).first()
    if not bp:
        raise HTTPException(status_code=404, detail="Board pack not found")
    path = Path(bp.pdf_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="PDF file missing")
    _increment_view(db, bp)
    return FileResponse(
        str(path),
        media_type="application/pdf",
        filename=f"board_pack_{bp.trial_balance_id}.pdf",
        content_disposition_type="attachment",
    )


@router.get("/view/{token}")
def view_board_pack(token: str, db: Session = Depends(get_db)):
    bp = db.query(BoardPack).filter(BoardPack.public_token == token).first()
    if not bp:
        raise HTTPException(status_code=404, detail="Board pack not found")
    path = Path(bp.pdf_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="PDF file missing")
    return FileResponse(str(path), media_type="application/pdf", content_disposition_type="inline")


class FinalizeBoardPackBody(BaseModel):
    reviewed_by: str = Field(default="board", max_length=256)


@router.post("/{board_pack_id}/finalize")
def finalize_board_pack(
    board_pack_id: int,
    body: FinalizeBoardPackBody,
    tenant_id: str = Depends(tenant_id_header),
    db: Session = Depends(get_db),
):
    bp = (
        db.query(BoardPack)
        .filter(BoardPack.id == board_pack_id, BoardPack.tenant_id == tenant_id)
        .first()
    )
    if not bp:
        raise HTTPException(status_code=404, detail="Board pack not found")

    data = build_board_pack_data(bp.trial_balance_id, db)
    gen = BoardPackGenerator(watermark="FINAL")
    out_path = str(Path(bp.pdf_path).resolve())
    gen.generate(data, out_path)
    pages = count_pdf_pages(out_path)

    bp.watermark = "FINAL"
    bp.status = BoardPackStatus.final
    bp.reviewed_by = body.reviewed_by
    bp.reviewed_at = datetime.utcnow()
    bp.generated_at = datetime.utcnow()
    db.commit()
    db.refresh(bp)

    token = bp.public_token
    return {
        "board_pack_id": bp.id,
        "pdf_path": bp.pdf_path,
        "public_url": f"/api/board-pack/view/{token}",
        "download_url": f"/api/board-pack/download/{token}",
        "pages": pages,
        "watermark": bp.watermark,
    }
