// ==================== AI PROVIDER SERVICE ====================
// Default: backend LLM (Anthropic or Gemini per backend/.env). Optional direct Claude/OpenAI in browser.

const AI_PROVIDER: "backend" | "claude" | "openai" = "backend";

const apiBase = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "";

export async function callAI(prompt: string, options?: {
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {

  const maxTokens = options?.maxTokens || 2000;
  const temperature = options?.temperature || 0.3;

  try {
    if (AI_PROVIDER === "backend") {
      if (!apiBase) {
        throw new Error(
          "Set VITE_API_URL to your backend URL (e.g. http://localhost:8000). Configure ANTHROPIC_API_KEY or GOOGLE_API_KEY in backend/.env."
        );
      }
      const res = await fetch(`${apiBase}/api/ai/invoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model_id: "",
          max_tokens: maxTokens,
          temperature,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(errText || `Backend returned ${res.status}`);
      }
      const data = await res.json();
      const text = data?.text;
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("Empty response from backend LLM");
      }
      return text.trim();
    }

    if (AI_PROVIDER === "claude") {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": import.meta.env.VITE_CLAUDE_API_KEY || "",
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          max_tokens: maxTokens,
          temperature,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Claude API error: ${error}`);
      }

      const data = await response.json();
      return data.content[0].text;
    }

    if (AI_PROVIDER === "openai") {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${import.meta.env.VITE_OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          max_tokens: maxTokens,
          temperature,
          messages: [
            {
              role: "user",
              content: prompt
            }
          ]
        })
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    }

    throw new Error(`Invalid AI provider: ${AI_PROVIDER}`);

  } catch (error: unknown) {
    console.error(`AI Provider (${AI_PROVIDER}) Error:`, error);
    const msg = error instanceof Error ? error.message : String(error);
    throw new Error(`AI call failed: ${msg}`);
  }
}

export function extractJSON(aiResponse: string): unknown {
  try {
    const codeBlockMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }

    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return JSON.parse(aiResponse);
  } catch {
    console.error("Failed to extract JSON from AI response:", aiResponse);
    throw new Error("AI response was not valid JSON");
  }
}

export function getCurrentProvider(): string {
  return AI_PROVIDER;
}

export async function testAIConnection(): Promise<{
  success: boolean;
  provider: string;
  message: string;
}> {
  try {
    const response = await callAI("Reply with just the word 'OK'", { maxTokens: 50 });
    return {
      success: true,
      provider: AI_PROVIDER,
      message: `Connected to ${AI_PROVIDER}. Response: ${response.substring(0, 50)}`
    };
  } catch (error: unknown) {
    return {
      success: false,
      provider: AI_PROVIDER,
      message: error instanceof Error ? error.message : String(error)
    };
  }
}
