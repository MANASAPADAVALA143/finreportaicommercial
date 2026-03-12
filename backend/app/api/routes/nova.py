import os
import time
import uuid
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from app.core.security import get_current_user
from app.api.schemas import NovaPrompt, NovaResponse
from app.services.nova_service import nova_service

router = APIRouter(prefix="/nova", tags=["Amazon Nova AI"])


class NovaInvokeRequest(BaseModel):
    model_id: str = "amazon.nova-lite-v1:0"
    prompt: str
    max_tokens: int = 600
    temperature: float = 0.3


@router.post("/invoke")
async def invoke_nova(body: NovaInvokeRequest):
    """Raw Bedrock invoke for CFO Decision Intelligence. Returns { text: raw response }."""
    try:
        text = nova_service.invoke(
            prompt=body.prompt,
            model_id=body.model_id,
            max_tokens=body.max_tokens,
            temperature=body.temperature,
        )
        return {"text": text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze", response_model=NovaResponse)
async def analyze_with_nova(
    prompt: NovaPrompt,
    current_user: dict = Depends(get_current_user)
):
    """
    Get AI-powered financial analysis using Amazon Nova.
    
    This endpoint allows users to ask financial questions and get
    intelligent responses powered by Amazon Nova AI.
    """
    try:
        result = await nova_service.generate_financial_analysis(
            prompt=prompt.prompt,
            context=prompt.context,
            max_tokens=prompt.max_tokens,
            temperature=prompt.temperature
        )
        
        return NovaResponse(
            response=result["response"],
            confidence=result["confidence"],
            metadata=result["metadata"]
        )
    
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error processing Nova request: {str(e)}"
        )


@router.post("/analyze-entry")
async def analyze_journal_entry(
    entry_data: dict,
    current_user: dict = Depends(get_current_user)
):
    """Analyze a journal entry using Amazon Nova."""
    try:
        result = await nova_service.analyze_journal_entry(entry_data)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error analyzing entry: {str(e)}"
        )


@router.post("/forecast")
async def generate_forecast(
    historical_data: dict,
    period: str = "next_quarter",
    current_user: dict = Depends(get_current_user)
):
    """Generate financial forecast using Amazon Nova."""
    try:
        result = await nova_service.generate_forecast(historical_data, period)
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error generating forecast: {str(e)}"
        )


@router.post("/compliance-check")
async def compliance_check(
    financial_data: dict,
    standard: str = "IFRS",
    current_user: dict = Depends(get_current_user)
):
    """Check financial data for compliance using Amazon Nova."""
    prompt = f"""Analyze the following financial data for {standard} compliance:

{financial_data}

Provide:
1. Compliance assessment
2. Any violations or concerns
3. Recommendations for remediation
4. Best practice suggestions
"""
    
    try:
        result = await nova_service.generate_financial_analysis(
            prompt=prompt,
            context=financial_data
        )
        return result
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Error checking compliance: {str(e)}"
        )


# --- Voice AI (Amazon Transcribe + Nova Lite + Polly) ---

VOICE_SYSTEM_PROMPT = (
    "You are a CFO financial assistant. Answer in 2-3 sentences max. "
    "Be direct and clear. Use plain language, no jargon."
)


def _transcribe_audio(audio_bytes: bytes, job_id: str, content_type: str) -> str:
    """Transcribe audio using Amazon Transcribe. Requires S3 bucket."""
    import boto3

    bucket = os.getenv("TRANSCRIBE_S3_BUCKET")
    if not bucket:
        raise ValueError("TRANSCRIBE_S3_BUCKET not configured")

    s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION", "us-east-1"))
    key = f"transcribe-input/{job_id}.webm"
    s3.put_object(Bucket=bucket, Key=key, Body=audio_bytes, ContentType=content_type or "audio/webm")
    uri = f"s3://{bucket}/{key}"

    transcribe = boto3.client("transcribe", region_name=os.getenv("AWS_REGION", "us-east-1"))
    transcribe.start_transcription_job(
        TranscriptionJobName=job_id,
        Media={"MediaFileUri": uri},
        MediaFormat="webm",
        LanguageCode="en-US",
    )
    for _ in range(60):
        job = transcribe.get_transcription_job(TranscriptionJobName=job_id)
        status = job["TranscriptionJob"]["TranscriptionJobStatus"]
        if status == "COMPLETED":
            import urllib.request
            out_uri = job["TranscriptionJob"]["Transcript"]["TranscriptFileUri"]
            with urllib.request.urlopen(out_uri) as r:
                data = json.load(r)
            return data["results"]["transcripts"][0]["transcript"].strip()
        if status == "FAILED":
            raise RuntimeError(job["TranscriptionJob"].get("FailureReason", "Transcription failed"))
        time.sleep(0.5)

    raise RuntimeError("Transcription timeout")


def _text_to_speech(text: str) -> bytes:
    """Convert text to speech using Amazon Polly (Joanna, neural)."""
    import boto3

    polly = boto3.client("polly", region_name=os.getenv("AWS_REGION", "us-east-1"))
    resp = polly.synthesize_speech(
        Text=text[:3000],
        OutputFormat="mp3",
        VoiceId="Joanna",
        Engine="neural",
    )
    return resp["AudioStream"].read()


@router.post("/voice")
async def voice_nova(
    audio: UploadFile = File(default=None),
    transcript: str = Form(default=None),
):
    """
    Voice AI: transcribe audio -> Nova Lite answer -> Polly TTS.
    Send multipart/form-data with either:
    - 'audio' file (uses Amazon Transcribe)
    - 'transcript' text (skip Transcribe; use when frontend has Web Speech API or voice chips)
    """
    import base64

    transcript_text = (transcript or "").strip()
    if not transcript_text and audio and audio.filename:
        audio_bytes = await audio.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="No audio data received")
        job_id = f"nova-voice-{uuid.uuid4().hex[:12]}"
        content_type = audio.content_type or "audio/webm"
        try:
            transcript_text = _transcribe_audio(audio_bytes, job_id, content_type)
        except Exception:
            return {
                "transcript": "",
                "text_response": "Transcription unavailable. Set TRANSCRIBE_S3_BUCKET for audio upload, or use voice chips.",
                "audio_base64": None,
            }

    if not transcript_text:
        raise HTTPException(status_code=400, detail="Provide either audio file or transcript")

    try:
        text_response = nova_service.invoke(
            prompt=transcript_text,
            model_id="us.amazon.nova-lite-v1:0",
            max_tokens=512,
            temperature=0.5,
        )
    except Exception as e:
        text_response = f"Sorry, I couldn't process that. ({str(e)})"

    audio_base64 = None
    try:
        mp3_bytes = _text_to_speech(text_response)
        audio_base64 = base64.b64encode(mp3_bytes).decode("utf-8")
    except Exception:
        pass

    return {"transcript": transcript_text, "text_response": text_response, "audio_base64": audio_base64}
