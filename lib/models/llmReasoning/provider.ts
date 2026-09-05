/**
 * Phase 9 - controlled LLM reasoning: provider configuration gate.
 *
 * HARD RULES (handoff §21-§24, §54):
 *  - The LLM is OPTIONAL. The deterministic core (DeterministicReasoningEngine,
 *    lib/models/reasoningEngine.ts) never depends on it; with no config the
 *    system is fully functional and no network call is ever attempted.
 *  - DISABLED BY DEFAULT. Three independent gates must ALL be satisfied
 *    before any external call can happen:
 *      1. LLM_REASONING_ENABLED=true            (explicit operator choice)
 *      2. LLM_PROVIDER=compatible + LLM_BASE_URL + LLM_MODEL + LLM_API_KEY
 *         (a concrete, configured endpoint - OpenAI, OpenRouter, Anthropic-
 *          compatible gateways, or a LOCAL model server)
 *      3. LLM_DATA_DISCLOSURE_ACK=true          (explicit acknowledgment
 *         that structured clinical evidence will be sent to that endpoint -
 *         local-first PHI protection, §24)
 *  - No vendor SDK is used: one OpenAI-compatible HTTP contract covers
 *    OpenAI, OpenRouter, and self-hosted servers (vLLM/Ollama/LM Studio),
 *    so the app never hard-codes a single vendor.
 *  - The provider returns raw text ONLY. Parsing, schema validation, and
 *    safety validation happen in engine.ts - the provider can never write
 *    to the DB, set provenance, or bypass the forbidden-claim scanner.
 */

export type LLMConfigStatus =
  | "DISABLED"           // operator has not enabled LLM reasoning (default)
  | "CONFIG_INCOMPLETE"  // enabled but endpoint/key/disclosure missing
  | "READY";             // fully configured; calls permitted

export interface LLMReasoningProviderConfig {
  providerName: string;  // e.g. "openai_compatible"
  baseUrl: string;       // e.g. https://openrouter.ai/api/v1 or http://localhost:11434/v1
  apiKey: string;
  model: string;
  timeoutMs: number;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function getLLMReasoningConfig(): { status: LLMConfigStatus; reason?: string; config?: LLMReasoningProviderConfig } {
  if (String(process.env.LLM_REASONING_ENABLED ?? "false") !== "true") {
    return { status: "DISABLED", reason: "LLM_REASONING_ENABLED is not true - deterministic reasoning only (default, offline-first)" };
  }
  const provider = env("LLM_PROVIDER");
  const baseUrl = env("LLM_BASE_URL");
  const apiKey = env("LLM_API_KEY");
  const model = env("LLM_MODEL");
  const ack = String(process.env.LLM_DATA_DISCLOSURE_ACK ?? "false") === "true";

  if (!ack) {
    return { status: "CONFIG_INCOMPLETE", reason: "LLM_DATA_DISCLOSURE_ACK is not true - operator must acknowledge that structured clinical evidence is sent to the configured endpoint" };
  }
  if (provider !== "compatible") {
    return { status: "CONFIG_INCOMPLETE", reason: "LLM_PROVIDER must be 'compatible' (OpenAI-compatible chat-completions endpoint)" };
  }
  if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
    return { status: "CONFIG_INCOMPLETE", reason: "LLM_BASE_URL must be an http(s) endpoint" };
  }
  if (!apiKey) {
    return { status: "CONFIG_INCOMPLETE", reason: "LLM_API_KEY is required (set a non-empty value even for local servers)" };
  }
  if (!model) {
    return { status: "CONFIG_INCOMPLETE", reason: "LLM_MODEL is required" };
  }

  const timeoutRaw = Number(env("LLM_TIMEOUT_MS") ?? "30000");
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw >= 1000 && timeoutRaw <= 120000 ? timeoutRaw : 30000;
  return {
    status: "READY",
    config: { providerName: provider, baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, timeoutMs },
  };
}

/** The single provider contract every backend must satisfy. Returns raw completion text. */
export interface LLMReasoningProvider {
  readonly providerName: string;
  readonly model: string;
  complete(system: string, user: string): Promise<string>;
}

/**
 * OpenAI-compatible chat-completions provider. Works with OpenAI, OpenRouter,
 * Anthropic-compatible gateways, and local servers (vLLM / Ollama / LM Studio)
 * without any vendor SDK. temperature=0 for reproducibility; JSON output is
 * requested but NEVER trusted (validated in engine.ts).
 */
export class OpenAICompatibleProvider implements LLMReasoningProvider {
  readonly providerName = "openai_compatible";
  constructor(private readonly cfg: LLMReasoningProviderConfig) {}

  get model(): string {
    return this.cfg.model;
  }

  async complete(system: string, user: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`LLM_HTTP_${res.status}`);
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const text = json.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        throw new Error("LLM_EMPTY_RESPONSE");
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createProviderFromConfig(cfg: LLMReasoningProviderConfig): LLMReasoningProvider {
  return new OpenAICompatibleProvider(cfg);
}
