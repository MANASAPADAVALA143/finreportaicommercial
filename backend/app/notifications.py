import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from twilio.rest import Client as TwilioClient


async def send_whatsapp_alert(message: str) -> None:
    """Send WhatsApp to CFO via Twilio."""
    try:
        client = TwilioClient(
            os.getenv("TWILIO_ACCOUNT_SID"),
            os.getenv("TWILIO_AUTH_TOKEN"),
        )
        client.messages.create(
            from_=f"whatsapp:{os.getenv('TWILIO_WHATSAPP_FROM')}",
            to=f"whatsapp:{os.getenv('CFO_WHATSAPP_NUMBER')}",
            body=message,
        )
        print("WhatsApp sent to CFO")
    except Exception as exc:
        print(f"WhatsApp error: {exc}")


async def send_email_alert(subject: str, data: dict) -> None:
    """Send email alert to CFO."""
    try:
        msg = MIMEMultipart()
        msg["From"] = os.getenv("SMTP_FROM")
        msg["To"] = os.getenv("CFO_EMAIL")
        msg["Subject"] = subject

        body = f"""
FinReportAI Automated Alert

{data.get('what_happened', '')}

WHY THIS HAPPENED:
{chr(10).join(data.get('why_it_happened', []))}

RECOMMENDED ACTION:
{data.get('what_to_do', '')}

BOARD LINE:
{data.get('board_line', '')}

Confidence: {data.get('confidence', 0)}%

---
FinReportAI Agentic AI System
Automated — No reply needed
        """

        msg.attach(MIMEText(body, "plain"))

        with smtplib.SMTP(os.getenv("SMTP_HOST"), int(os.getenv("SMTP_PORT", "587"))) as server:
            server.starttls()
            server.login(os.getenv("SMTP_USER"), os.getenv("SMTP_PASSWORD"))
            server.send_message(msg)

        print(f"Email sent: {subject}")
    except Exception as exc:
        print(f"Email error: {exc}")
