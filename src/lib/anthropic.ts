/**
 * Thin client over the real Anthropic Messages API — the same "actual documented
 * integration, never an invented stand-in" rule src/lib/whatsapp.ts follows for Meta's Graph
 * API, applied here for Phase 5. Deliberately a raw `fetch` call, no SDK dependency: this
 * stays a thin, swappable wrapper (the plan doc itself says "Anthropic API key أو مزوّد
 * آخر" — another provider is an explicit possibility), and src/lib/aiOrchestrator.ts is its
 * only caller.
 *
 * Needs ANTHROPIC_API_KEY (see .env.example). Missing config fails loudly at CALL time via
 * AnthropicConfigError — not at import time like JWT_SECRET in auth.ts — so the rest of the
 * app (Phases 1-4, 6) keeps working with Phase 5 totally unconfigured, exactly like
 * WHATSAPP_* before Phase 4 was wired up.
 *
 * UPDATE (this session): the real user's own ANTHROPIC_API_KEY was provided and the *exact*
 * request shape this file sends (POST /v1/messages, same headers, same body fields) was
 * manually verified end-to-end with a real `curl` call against the real API in this sandbox —
 * it authenticated and returned a real model response. What that confirms: the key is live,
 * this file's request/response shape is correct, and the ANTHROPIC_MODEL default below is a
 * real, currently-served model (the old default had been retired — see that constant's own
 * comment). What it does NOT confirm: `runAiTurn()`'s full tool-calling loop has still never
 * run for real in this sandbox, because that needs a real Prisma-backed database, and
 * `prisma generate` still can't run here at all (see README's "Known limitation" — a sandbox
 * network-policy block, unrelated to this key). Run a real conversation through the webhook
 * once this is deployed somewhere `prisma generate` actually works, before trusting the full
 * loop (tool definitions, multi-turn tool_result feeding, MAX_TOOL_ITERATIONS) in production.
 */

const ANTHROPIC_API_VERSION = "2023-06-01";
// Overridable once you've chosen a model/budget (the plan doc's open "LLM" decision row) —
// this default is just a reasonable starting point, not a commitment. UPDATED after the
// first real test against a live key (this session): the previous default
// ("claude-sonnet-4-5-20250929") now 404s with not_found_error — that model has been
// retired. Confirmed via a real GET /v1/models call that "claude-sonnet-5" is currently live
// and confirmed via a real POST /v1/messages call that it actually responds. Re-check
// GET /v1/models if this ever starts 404ing again — model names get retired over time.
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

export class AnthropicConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnthropicConfigError";
  }
}

function requireAnthropicConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AnthropicConfigError(
      "ANTHROPIC_API_KEY غير معرّف في .env — المرحلة 5 (الذكاء الاصطناعي لخدمة العملاء) لا يمكنها العمل بدونه. راجع قسم المرحلة 5 في README."
    );
  }
  return apiKey;
}

// Loosely typed on purpose — these mirror Anthropic's Messages API content-block shapes
// (text / tool_use / tool_result) closely enough for src/lib/aiOrchestrator.ts's loop
// without re-declaring the SDK's full type surface for a client this thin.
export type AnthropicContentBlock = { type: string; [key: string]: unknown };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

export interface AnthropicMessagesResponse {
  id: string;
  stop_reason: string | null;
  content: AnthropicContentBlock[];
}

/**
 * One call to POST /v1/messages, non-streaming. src/lib/aiOrchestrator.ts loops this,
 * feeding tool_result blocks back in as the next user message, until the model stops
 * calling tools.
 */
export async function callMessagesApi(params: {
  system: string;
  messages: AnthropicMessage[];
  tools: AnthropicToolDef[];
  maxTokens?: number;
  toolChoice?: { type: "auto" | "any" } | { type: "tool"; name: string };
}): Promise<AnthropicMessagesResponse> {
  const apiKey = requireAnthropicConfig();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: params.maxTokens ?? 1024,
      system: params.system,
      messages: params.messages,
      tools: params.tools,
      ...(params.toolChoice ? { tool_choice: params.toolChoice } : {}),
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Anthropic's error payload shape: { type: "error", error: { type, message } }
    const message = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(`فشل استدعاء Anthropic API: ${message}`);
  }
  return data as AnthropicMessagesResponse;
}
