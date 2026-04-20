# VAPI Agent Prompts — Gnanova Voice OS

This folder contains the production system prompts for all three
voice agents deployed across Gnanova's product suite.

| File | Agent | Product | Call type |
|------|-------|---------|-----------|
| `nova-finreportai.md` | Nova | FinReportAI | Outbound CFO qualification |
| `atlas-legalmind.md` | Atlas | LegalMind AI | Inbound legal intake |
| `cipher-clearpath.md` | Cipher | ClearPath AI | KYC onboarding intake |

## How to use

1. Open the relevant `.md` file
2. Copy the content under `## SYSTEM PROMPT`
3. Paste into Vapi dashboard → Assistants → [Agent] → System prompt
4. Set first message as documented in `## VAPI ASSISTANT SETTINGS`
5. Confirm injected variable names match exactly

## Variable injection

Variables are injected at call time via `assistantOverrides.variableValues`
in the backend. See:
- Nova: `backend/app/api/routes/voice_inbound.py` lines 99–108
- Atlas: `voice-layer/config/firm-configs.ts`
- Cipher: `voice-layer/config/finance-firm-configs.ts`

## Updating prompts

Update the `.md` file here first, then paste into Vapi dashboard.
This file is the source of truth — not the Vapi dashboard.

## Testing

After any prompt update, run the E2E test:
- Fill `/get-demo` with a real phone number in E.164 format
- Nova should call within 60 seconds
- Opening should use `{{KNOWN_PAIN}}` not generic line
- Post-call: check Supabase `inbound_leads` for `call_triggered=true`
