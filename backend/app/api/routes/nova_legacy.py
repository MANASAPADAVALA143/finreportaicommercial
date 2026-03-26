"""Backward-compatible /api/nova/* routes (same handlers as /api/ai/*)."""
from fastapi import APIRouter, File, Form, UploadFile

from app.api.routes.nova import AIInvokeRequest, invoke_ai, voice_ai

router = APIRouter(prefix="/nova", tags=["AI (legacy path)"])


@router.post("/invoke")
async def legacy_invoke_nova(body: AIInvokeRequest):
    return await invoke_ai(body)


@router.post("/voice")
async def legacy_voice_nova(
    audio: UploadFile = File(default=None),
    transcript: str = Form(default=None),
):
    return await voice_ai(audio=audio, transcript=transcript)
