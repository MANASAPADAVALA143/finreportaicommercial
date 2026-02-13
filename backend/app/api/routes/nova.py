from fastapi import APIRouter, Depends, HTTPException
from app.core.security import get_current_user
from app.api.schemas import NovaPrompt, NovaResponse
from app.services.nova_service import nova_service

router = APIRouter(prefix="/nova", tags=["Amazon Nova AI"])


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
