/**
 * AI SERVICE INTEGRATION   (Middleware / Integration)
 *
 * One function, generateText(), hides which AI service answers:
 *
 *   1. Google Gemini API   - used when GEMINI_API_KEY is set (server-only).
 *   2. Local Ollama        - used when OLLAMA_BASE_URL / OLLAMA_MODEL point at
 *                            a running Ollama server (the existing requester AI
 *                            already uses this).
 *   3. null                - neither is reachable. The caller then falls back
 *                            to LIVE's built-in knowledge base / safety text.
 *
 * Every provider call has a hard timeout, so a slow or missing AI service can
 * never hang a request. Each attempt is written to integration_logs so the
 * auditor's "Integration logs" page shows AI availability and latency. Prompts
 * and answers are NOT logged, because they may contain personal details.
 *
 * SERVER ONLY. API keys never reach the browser.
 */

import "server-only";

import { logIntegrationEvent } from "@/lib/integration-logger";
import { createLogger } from "@/lib/middleware/logger";

const log = createLogger({ logType: "integration", route: "ai-providers" });

export type AiSource = "gemini" | "ollama";

export interface AiResult {
  text: string;
  source: AiSource;
  model: string;
}

export interface GenerateOptions {
  /** Correlation id of the API request, so logs line up end to end. */
  correlationId?: string;
  /** Soft upper bound on answer length. */
  maxTokens?: number;
  /** Which feature asked; recorded in the integration log. */
  feature: "assistant.chat" | "requester.ai";
}

const GEMINI_TIMEOUT_MS = 12_000;
const OLLAMA_TIMEOUT_MS = 15_000;

function recordAttempt(input: {
  provider: string;
  model: string;
  endpoint: string;
  ok: boolean;
  status?: number | null;
  durationMs: number;
  error?: string;
  options: GenerateOptions;
}) {
  // Fire-and-forget: logging must never slow down or break the chat.
  void logIntegrationEvent({
    provider_name: input.provider,
    operation: input.options.feature,
    endpoint_name: input.endpoint,
    http_status: input.status ?? null,
    result: input.ok ? "success" : "failure",
    duration_ms: input.durationMs,
    error_message: input.error ? input.error.slice(0, 300) : null,
    correlation_id:
      input.options.correlationId && /^[0-9a-f-]{36}$/i.test(input.options.correlationId)
        ? input.options.correlationId
        : null,
    safe_request_metadata: { model: input.model },
  }).catch(() => undefined);
}

async function callGemini(prompt: string, options: GenerateOptions): Promise<AiResult | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL?.trim() || "gemma-3-1b-it";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const started = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        // Gemma models on the Gemini API do not accept a separate system
        // instruction, so the instructions travel inside the prompt itself.
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: options.maxTokens ?? 400 },
      }),
    });

    if (!response.ok) {
      recordAttempt({ provider: "Google Gemini", model, endpoint: "generativelanguage.googleapis.com", ok: false, status: response.status, durationMs: Date.now() - started, error: `HTTP ${response.status}`, options });
      return null;
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

    recordAttempt({ provider: "Google Gemini", model, endpoint: "generativelanguage.googleapis.com", ok: Boolean(text), status: response.status, durationMs: Date.now() - started, error: text ? undefined : "Empty response", options });
    return text ? { text, source: "gemini", model } : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn("gemini_unavailable", { cause: message });
    recordAttempt({ provider: "Google Gemini", model, endpoint: "generativelanguage.googleapis.com", ok: false, durationMs: Date.now() - started, error: message, options });
    return null;
  }
}

async function callOllama(prompt: string, options: GenerateOptions): Promise<AiResult | null> {
  const baseUrl = (process.env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL?.trim() || "gemma3:1b-it-q4_K_M";
  const started = Date.now();

  try {
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: options.maxTokens ?? 400 },
      }),
    });

    if (!response.ok) {
      recordAttempt({ provider: "Ollama", model, endpoint: "ollama/api/generate", ok: false, status: response.status, durationMs: Date.now() - started, error: `HTTP ${response.status}`, options });
      return null;
    }

    const payload = (await response.json()) as { response?: string };
    const text = payload.response?.trim();
    recordAttempt({ provider: "Ollama", model, endpoint: "ollama/api/generate", ok: Boolean(text), status: response.status, durationMs: Date.now() - started, error: text ? undefined : "Empty response", options });
    return text ? { text, source: "ollama", model } : null;
  } catch (error) {
    // Most commonly: Ollama is simply not installed/running. That is an
    // expected state, so this is a debug-level event, not an error.
    const message = error instanceof Error ? error.message : String(error);
    log.debug("ollama_unavailable", { cause: message });
    recordAttempt({ provider: "Ollama", model, endpoint: "ollama/api/generate", ok: false, durationMs: Date.now() - started, error: message, options });
    return null;
  }
}

/**
 * Tries Gemini, then Ollama. Returns null when no AI service answered, so the
 * caller can use its built-in fallback. Never throws.
 */
export async function generateText(prompt: string, options: GenerateOptions): Promise<AiResult | null> {
  return (await callGemini(prompt, options)) ?? (await callOllama(prompt, options));
}

/** Strips characters that would let user text pose as prompt instructions. */
export function sanitiseForPrompt(text: string, max = 600): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}
