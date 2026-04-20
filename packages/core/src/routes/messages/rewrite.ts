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
type Rule = (parsed: Parsed, model: string | undefined) => Parsed;

const injectDefaultMaxTokens: Rule = (parsed) =>
  parsed.max_tokens == null
    ? { ...parsed, max_tokens: DEFAULT_MAX_TOKENS }
    : parsed;

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

const RULES: readonly Rule[] = [injectDefaultMaxTokens, rewriteOpus47Thinking];

export interface RewriteResult {
  body: string;
  model: string | undefined;
}

export function rewriteRequestBody(raw: string): RewriteResult {
  let parsed: Parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // invalid JSON — let upstream reject it, forward raw unchanged.
    return { body: raw, model: undefined };
  }
  const rewritten = RULES.reduce((acc, rule) => {
    const m = typeof acc.model === "string" ? acc.model : undefined;
    return rule(acc, m);
  }, parsed);
  const finalModel =
    typeof rewritten.model === "string" ? rewritten.model : undefined;
  const body = rewritten === parsed ? raw : JSON.stringify(rewritten);
  return { body, model: finalModel };
}
