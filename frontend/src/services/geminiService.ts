const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
const KEY = import.meta.env.VITE_GEMINI_API_KEY || '';

export async function callGemini(prompt: string): Promise<string> {
  const res = await fetch(`${GEMINI_URL}?key=${KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 512, responseMimeType: 'application/json' },
    }),
  });
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
}
