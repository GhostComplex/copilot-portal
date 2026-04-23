/**
 * Pure Anthropic→Copilot translation for POST /v1/messages.
 *
 * Both helpers normalize an inbound Anthropic-format request into the shape
 * the Copilot upstream expects: `transformRequestBody` for the JSON body,
 * `filterAnthropicBeta` for the `anthropic-beta` header.
 */

const DEFAULT_MAX_TOKENS = 16384;

export interface TransformResult {
  body: string;
  model: string | undefined;
}

export function transformRequestBody(raw: string): TransformResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { body: raw, model: undefined };
  }
  const model = typeof parsed.model === "string" ? parsed.model : undefined;

  let changed = false;
  const out: Record<string, unknown> = { ...parsed };

  if (out.max_tokens == null) {
    out.max_tokens = DEFAULT_MAX_TOKENS;
    changed = true;
  }

  // claude-opus-4.7 rejects `thinking.type=enabled`; rewrite to `adaptive`.
  // Effort is left to client control (/effort), not injected here.
  if (
    model?.startsWith("claude-opus-4.7") &&
    typeof out.thinking === "object" &&
    out.thinking !== null &&
    (out.thinking as Record<string, unknown>).type === "enabled"
  ) {
    const next = { ...(out.thinking as Record<string, unknown>) };
    delete next.budget_tokens;
    next.type = "adaptive";
    out.thinking = next;
    changed = true;
  }

  // Strip `output_config.format` (Anthropic Structured Outputs).
  // Upstream rejects this field with 400 regardless of beta header. Some SDKs
  // (e.g. claw-code's) auto-inject it, leaving the application no way to opt out.
  if (
    typeof out.output_config === "object" &&
    out.output_config !== null &&
    "format" in (out.output_config as object)
  ) {
    const next = { ...(out.output_config as Record<string, unknown>) };
    delete next.format;
    if (Object.keys(next).length > 0) {
      out.output_config = next;
    } else {
      delete out.output_config;
    }
    changed = true;
  }

  return { body: changed ? JSON.stringify(out) : raw, model };
}

/**
 * Filter the client's `anthropic-beta` header, removing betas the Copilot
 * upstream rejects. Returns `undefined` if nothing remains.
 *
 * - `context-1m-2025-08-07` is rejected upstream (400 "unsupported beta").
 * - All other betas are forwarded as-is.
 */
export function filterAnthropicBeta(
  raw: string | undefined | null
): string | undefined {
  if (!raw) return undefined;
  const kept = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "context-1m-2025-08-07");
  return kept.length > 0 ? kept.join(",") : undefined;
}
