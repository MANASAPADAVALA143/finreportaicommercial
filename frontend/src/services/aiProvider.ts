// ==================== AI PROVIDER SERVICE ====================
// Swappable AI Integration — Change ONE line to swap providers
// Supports: AWS Bedrock Nova Lite, Claude 3 Haiku, GPT-4o-mini

// ===================================================
// 🎯 CHANGE THIS LINE TO SWAP AI PROVIDER
// ===================================================
const AI_PROVIDER: "aws-nova" | "claude" | "openai" = "aws-nova";
// ===================================================

import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

// ==================== AWS BEDROCK CLIENT ====================
// Env vars MUST be prefixed with VITE_ so Vite exposes them to the browser.
// Use: VITE_AWS_ACCESS_KEY_ID, VITE_AWS_SECRET_ACCESS_KEY, VITE_AWS_REGION
// For temporary/SSO credentials also set: VITE_AWS_SESSION_TOKEN

const apiBase = (import.meta.env.VITE_API_URL && String(import.meta.env.VITE_API_URL).trim()) || "";

const awsRegion = import.meta.env.VITE_AWS_REGION || "us-east-1";
const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID || "";
const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY || "";
const sessionToken = import.meta.env.VITE_AWS_SESSION_TOKEN || undefined;

const bedrockCredentials = accessKeyId && secretAccessKey
  ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }
  : undefined;

const bedrockClient = new BedrockRuntimeClient({
  region: awsRegion,
  ...(bedrockCredentials ? { credentials: bedrockCredentials } : {}),
});

// ==================== MAIN AI CALL FUNCTION ====================

export async function callAI(prompt: string, options?: {
  maxTokens?: number;
  temperature?: number;
}): Promise<string> {
  
  const maxTokens = options?.maxTokens || 2000;
  const temperature = options?.temperature || 0.3;

  try {
    // ===================================================
    // AWS BEDROCK - AMAZON NOVA LITE (backend preferred)
    // When VITE_API_URL is set, call backend so AWS credentials stay server-side.
    // ===================================================
    if (AI_PROVIDER === "aws-nova") {
      if (apiBase) {
        const res = await fetch(`${apiBase}/api/nova/invoke`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt,
            model_id: "us.amazon.nova-lite-v1:0",
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
          throw new Error("Empty response from Nova (backend)");
        }
        return text.trim();
      }
      if (!accessKeyId || !secretAccessKey) {
        throw new Error(
          "AWS credentials not configured. Either set VITE_API_URL to your backend URL (recommended: backend uses backend/.env AWS keys) or set VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY in frontend/.env and restart the dev server."
        );
      }
      const command = new ConverseCommand({
        modelId: "us.amazon.nova-lite-v1:0",
        messages: [
          {
            role: "user",
            content: [{ text: prompt }]
          }
        ],
        inferenceConfig: {
          maxTokens,
          temperature
        }
      });

      const response = await bedrockClient.send(command);
      const text = response.output?.message?.content?.[0]?.text || "";
      
      if (!text) {
        throw new Error("Empty response from AWS Nova");
      }

      return text;
    }

    // ===================================================
    // ANTHROPIC CLAUDE 3 HAIKU
    // ===================================================
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

    // ===================================================
    // OPENAI GPT-4o-mini
    // ===================================================
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

  } catch (error: any) {
    console.error(`AI Provider (${AI_PROVIDER}) Error:`, error);
    const msg = error?.message || String(error);
    if (/security token|invalid.*token|InvalidClientTokenId|SignatureDoesNotMatch/i.test(msg)) {
      throw new Error(
        "AWS security token is invalid or expired. Use the backend: set VITE_API_URL=http://localhost:8000 and put AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in backend/.env (no VITE_ keys in frontend). Or refresh your AWS credentials in frontend/.env and restart the dev server."
      );
    }
    throw new Error(`AI call failed: ${msg}`);
  }
}

// ==================== HELPER: EXTRACT JSON FROM AI RESPONSE ====================

export function extractJSON(aiResponse: string): any {
  try {
    // Try to find JSON in markdown code blocks
    const codeBlockMatch = aiResponse.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }

    // Try to find raw JSON object
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    // If no JSON found, try parsing entire response
    return JSON.parse(aiResponse);
  } catch (e) {
    console.error("Failed to extract JSON from AI response:", aiResponse);
    throw new Error("AI response was not valid JSON");
  }
}

// ==================== HELPER: GET CURRENT AI PROVIDER ====================

export function getCurrentProvider(): string {
  return AI_PROVIDER;
}

// ==================== HELPER: TEST AI CONNECTION ====================

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
  } catch (error: any) {
    return {
      success: false,
      provider: AI_PROVIDER,
      message: error.message
    };
  }
}
