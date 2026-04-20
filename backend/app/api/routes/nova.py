import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict
from app.core.security import get_current_user
from app.api.schemas import NovaPrompt, NovaResponse
from app.services import llm_service

router = APIRouter(prefix="/ai", tags=["AI"])


class AIInvokeRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model_id: str = ""
    prompt: str
    max_tokens: int = 600
    temperature: float = 0.3


@router.post("/invoke")
async def invoke_ai(body: AIInvokeRequest):
    """LLM invoke via Anthropic Claude."""
    try:
        text = llm_service.invoke(
            prompt=body.prompt,
            model_id=body.model_id or None,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        )
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze", response_model=NovaResponse)
async def analyze_with_ai(
    prompt: NovaPrompt,
    current_user: dict = Depends(get_current_user),
):
    """Financial Q&A via Anthropic Claude."""
    try:
        full_prompt = prompt.prompt
        if prompt.context is not None:
            full_prompt = f"{prompt.prompt}\n\nContext:\n{prompt.context}"
        text = llm_service.invoke(
            prompt=full_prompt,
            max_tokens=prompt.max_tokens,
            temperature=prompt.temperature,
        )

        return NovaResponse(
            response=text,
            confidence=0.82,
            metadata={"provider": llm_service.provider_label()},
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing AI request: {str(e)}",
        )


@router.post("/analyze-entry")
async def analyze_journal_entry(
    entry_data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Analyze a journal entry using Anthropic Claude."""
    try:
        text = llm_service.invoke(
            prompt=f"Analyze this journal entry for anomalies: {entry_data}",
            system="You are an expert accountant analyzing journal entries for fraud and anomalies.",
            max_tokens=1500,
            temperature=0.3,
        )
        return {"analysis": text}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error analyzing entry: {str(e)}",
        )


@router.post("/forecast")
async def generate_forecast(
    historical_data: dict,
    period: str = "next_quarter",
    current_user: dict = Depends(get_current_user),
):
    """Generate financial forecast using Anthropic Claude."""
    try:
        prompt = (
            f"You are a financial analyst. Given this historical data, generate a concise forecast for {period}. "
            f"Use bullet points and state key assumptions.\n\nData:\n{historical_data}"
        )
        text = llm_service.invoke(prompt=prompt, max_tokens=2000, temperature=0.35)
        return {"forecast": text, "period": period, "provider": llm_service.provider_label()}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating forecast: {str(e)}",
        )


@router.post("/compliance-check")
async def compliance_check(
    financial_data: dict,
    standard: str = "IFRS",
    current_user: dict = Depends(get_current_user),
):
    """Check financial data for compliance using the configured LLM."""
    prompt = f"""Analyze the following financial data for {standard} compliance:

{financial_data}

Provide:
1. Compliance assessment
2. Any violations or concerns
3. Recommendations for remediation
4. Best practice suggestions
"""

    try:
        text = llm_service.invoke(
            prompt=prompt,
            system="You are a financial analysis expert.",
            max_tokens=1200,
            temperature=0.3,
        )
        return {"response": text, "provider": llm_service.provider_label()}
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error checking compliance: {str(e)}",
        )


# --- Voice: transcript (or uploaded text) -> LLM ---

VOICE_SYSTEM_PROMPT = (
    "You are a CFO financial assistant. Answer in 2-3 sentences max. "
    "Be direct and clear. Use plain language, no jargon."
)


@router.post("/voice")
async def voice_ai(
    audio: UploadFile = File(default=None),
    transcript: str = Form(default=None),
):
    """
    Voice assistant: requires transcript text, returns Claude response.
    """
    transcript_text = (transcript or "").strip()
    if not transcript_text and audio and audio.filename:
        raise HTTPException(status_code=400, detail="Audio transcription is not enabled. Send transcript text.")

    if not transcript_text:
        raise HTTPException(status_code=400, detail="Provide either audio file or transcript")

    try:
        text_response = llm_service.invoke(
            prompt=transcript_text,
            system=VOICE_SYSTEM_PROMPT,
            max_tokens=512,
            temperature=0.5,
        )
    except Exception as e:
        text_response = f"Sorry, I couldn't process that. ({str(e)})"
    return {"transcript": transcript_text, "text_response": text_response, "audio_base64": None}