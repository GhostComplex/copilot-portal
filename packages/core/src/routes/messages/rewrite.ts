/**
 * Anthropic→Copilot request rewrites for POST /v1/messages.
 *
 * - `transformRequestBody`: pure body-only normalization.
 * - `rewriteContext1m`: cross-cutting (header + body) handling for the
 *   `context-1m-2025-08-07` beta. Lives outside the body-only transform
 *   because it has to read AND mutate the `anthropic-beta` header.
 * - `rewriteRequest`: the entry point wired into `Pipeline.translate(...)`.
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
 * Cross-cutting: when the client sends `anthropic-beta: context-1m-2025-08-07`,
 * upstream rejects the beta header but exposes the 1M variants as separate
 * model ids. Strip the beta value from the header AND rewrite the model in
 * the body, in lockstep.
 */
export function rewriteContext1m(input: {
  headers: Record<string, string | undefined>;
  body: string;
}): { headers: Record<string, string | undefined>; body: string } {
  const beta = input.headers["anthropic-beta"];
  if (!hasContext1mBeta(beta)) return input;

  const remaining = beta!
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== CONTEXT_1M_BETA);
  const newBeta = remaining.length > 0 ? remaining.join(",") : undefined;
  const headers = { ...input.headers, "anthropic-beta": newBeta };

  let body = input.body;
  try {
    const parsed = JSON.parse(input.body) as Record<string, unknown>;
    const model = typeof parsed.model === "string" ? parsed.model : undefined;
    if (model && ONE_M_MODEL_MAP[model]) {
      body = JSON.stringify({ ...parsed, model: ONE_M_MODEL_MAP[model] });
    }
  } catch {
    // invalid JSON — pass body through unchanged
  }

  return { headers, body };
}

/**
 * Pipeline `.translate(...)` entry point: cross-cutting 1M-context handling
 * (see `rewriteContext1m`) followed by body normalization (see
 * `transformRequestBody`). Order matters — the 1M rewrite mutates `model`,
 * which downstream body rewrites may key off.
 */
export function rewriteRequest(input: {
  headers: Record<string, string | undefined>;
  body: string;
}): { headers: Record<string, string | undefined>; body: string } {
  const ctx1m = rewriteContext1m(input);
  const result = transformRequestBody(ctx1m.body);
  const body = typeof result === "string" ? result : result.body;
  return { headers: ctx1m.headers, body };
}
