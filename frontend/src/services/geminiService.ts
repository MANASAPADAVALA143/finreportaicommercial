import { callAI } from './aiProvider';

/**
 * All LLM calls use the FastAPI backend (`POST /api/ai/invoke`) with Anthropic Claude.
 * Configure `ANTHROPIC_API_KEY` in `backend/.env` and `VITE_API_URL` in `frontend/.env`.
 * The name `callGemini` is kept for backward compatibility with existing imports.
 */
export async function callGemini(prompt: string): Promise<string> {
  const apiBase = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || '';
  if (!apiBase) {
    console.warn('VITE_API_URL not set; LLM calls are disabled.');
    return '{}';
  }
  try {
    return await callAI(prompt, { maxTokens: 2000, temperature: 0.1 });
  } catch (e) {
    console.warn('Backend LLM (Anthropic) call failed:', e);
    return '{}';
  }
}
