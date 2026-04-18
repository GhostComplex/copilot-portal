/**
 * Pure, client-body rewrite rules for POST /v1/messages.
 *
 * Each rule takes the parsed request and the extracted model, and returns
 * either the same reference (no-op) or a new object with the rewrite
 * applied. `rewriteRequestBody` threads rules through a reduce and only
 * re-stringifies when something actually changed.
 */

const DEFAULT_MAX_TOKENS = 16384;

type Parsed = Record<string, unknown>;
type Rule = (
  parsed: Parsed,
  model: string | undefined,
  beta: string | undefined
) => Parsed;

const injectDefaultMaxTokens: Rule = (parsed) =>
  parsed.max_tokens == null
    ? { ...parsed, max_tokens: DEFAULT_MAX_TOKENS }
    : parsed;

/**
 * Copilot upstream rejects `anthropic-beta: context-1m-*` and `fast-mode-*`,
 * but exposes the same variants via model-name suffixes (`-1m`, `-fast`).
 * When the client signals these via the beta header, append the suffix to
 * the model name so the upstream actually selects the variant.
 */
const VARIANT_SUFFIXES: ReadonlyArray<{ prefix: string; suffix: string }> = [
  { prefix: "context-1m-", suffix: "-1m" },
  { prefix: "fast-mode-", suffix: "-fast" },
];

const resolveModelVariant: Rule = (parsed, model, beta) => {
  if (!model || !beta) return parsed;
  const tokens = beta.split(",").map((s) => s.trim());
  let next = model;
  for (const { prefix, suffix } of VARIANT_SUFFIXES) {
    const present = tokens.some((t) => t.startsWith(prefix));
    if (present && !next.endsWith(suffix)) next += suffix;
  }
  return next === model ? parsed : { ...parsed, model: next };
};

/**
 * claude-opus-4.7 rejects `thinking.type = "enabled"` and requires
 * `thinking.type = "adaptive"` + `output_config.effort` instead.
 * As of 2026-04, 4.7 only accepts `effort: "medium"`.
 */
const rewriteOpus47Thinking: Rule = (parsed, model) => {
  if (!model?.startsWith("claude-opus-4.7")) return parsed;
  const thinking = parsed.thinking as { type?: string } | undefined;
  if (thinking?.type !== "enabled") return parsed;
  const outputConfig =
    (parsed.output_config as Record<string, unknown> | undefined) ?? {};
  return {
    ...parsed,
    thinking: { type: "adaptive" },
    output_config: { ...outputConfig, effort: "medium" },
  };
};

const RULES: readonly Rule[] = [
  resolveModelVariant,
  injectDefaultMaxTokens,
  rewriteOpus47Thinking,
];

export interface RewriteResult {
  body: string;
  model: string | undefined;
}

export function rewriteRequestBody(raw: string, beta?: string): RewriteResult {
  let parsed: Parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // invalid JSON — let upstream reject it, forward raw unchanged.
    return { body: raw, model: undefined };
  }
  const rewritten = RULES.reduce((acc, rule) => {
    const m = typeof acc.model === "string" ? acc.model : undefined;
    return rule(acc, m, beta);
  }, parsed);
  const finalModel =
    typeof rewritten.model === "string" ? rewritten.model : undefined;
  const body = rewritten === parsed ? raw : JSON.stringify(rewritten);
  return { body, model: finalModel };
}
