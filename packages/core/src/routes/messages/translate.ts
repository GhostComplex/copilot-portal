/**
 * Pure Anthropic→Copilot translation for POST /v1/messages.
 *
 * Both helpers normalize an inbound Anthropic-format request into the shape
 * the Copilot upstream expects: `transformRequestBody` for the JSON body,
 * `filterAnthropicBeta` for the `anthropic-beta` header.
 */

const DEFAULT_MAX_TOKENS = 16384;

const CONTEXT_1M_BETA = "context-1m-2025-08-07";

// When the client requests 1M context via `anthropic-beta: context-1m-2025-08-07`,
// upstream rejects the beta header. The 1M variants are exposed as separate
// model ids instead. Claude Code sends `claude-opus-4.X[1m]` which it expands
// client-side to base model + this beta header — the rewrite below maps that
// onto the upstream's actual 1M model ids.
const ONE_M_MODEL_MAP: Record<string, string> = {
  "claude-opus-4.6": "claude-opus-4.6-1m",
  "claude-opus-4.7": "claude-opus-4.7-1m-internal",
};

function hasContext1mBeta(beta: string | undefined): boolean {
  if (!beta) return false;
  return beta
    .split(",")
    .map((s) => s.trim())
    .includes(CONTEXT_1M_BETA);
}

export interface TransformResult {
  body: string;
  model: string | undefined;
}

export function transformRequestBody(
  raw: string,
  inboundHeaders: Record<string, string | undefined> = {}
): TransformResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { body: raw, model: undefined };
  }
  let model = typeof parsed.model === "string" ? parsed.model : undefined;

  let changed = false;
  const out: Record<string, unknown> = { ...parsed };

  if (out.max_tokens == null) {
    out.max_tokens = DEFAULT_MAX_TOKENS;
    changed = true;
  }

  // 1M-context model rewrite: see ONE_M_MODEL_MAP comment above.
  if (model && hasContext1mBeta(inboundHeaders["anthropic-beta"])) {
    const mapped = ONE_M_MODEL_MAP[model];
    if (mapped) {
      out.model = mapped;
      model = mapped;
      changed = true;
    }
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

  // Strip `context_management` — upstream rejects it with 400 "Extra inputs".
  if ("context_management" in out) {
    delete out.context_management;
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
    .filter((s) => s !== CONTEXT_1M_BETA);
  return kept.length > 0 ? kept.join(",") : undefined;
}
