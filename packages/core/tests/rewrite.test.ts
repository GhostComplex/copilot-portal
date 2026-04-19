import { describe, it, expect } from "vitest";
import { rewriteRequestBody } from "../src/routes/messages/rewrite";

describe("rewriteRequestBody", () => {
  it("returns raw body and undefined model on invalid JSON", () => {
    const raw = "not json";
    const result = rewriteRequestBody(raw);
    expect(result.body).toBe(raw);
    expect(result.model).toBeUndefined();
  });

  it("extracts model from parsed body", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
    });
    expect(rewriteRequestBody(raw).model).toBe("claude-sonnet-4");
  });

  it("returns undefined model when field is missing or non-string", () => {
    expect(
      rewriteRequestBody(JSON.stringify({ max_tokens: 1024 })).model
    ).toBeUndefined();
    expect(
      rewriteRequestBody(JSON.stringify({ model: 42, max_tokens: 1024 })).model
    ).toBeUndefined();
  });

  it("returns the raw string unchanged when no rewrites apply", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(rewriteRequestBody(raw).body).toBe(raw);
  });

  it("injects default max_tokens when missing", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.max_tokens).toBe(16384);
  });

  it("preserves caller-provided max_tokens", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 42,
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.max_tokens).toBe(42);
  });

  it("rewrites thinking.type=enabled to adaptive+effort for opus-4.7", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 1024,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.thinking).toEqual({ type: "adaptive" });
    expect(sent.output_config).toEqual({ effort: "medium" });
  });

  it("merges effort into an existing output_config for opus-4.7", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 1024,
      thinking: { type: "enabled" },
      output_config: { foo: "bar" },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.output_config).toEqual({ foo: "bar", effort: "medium" });
  });

  it("does not rewrite thinking for non-4.7 models", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6",
      max_tokens: 1024,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    expect(rewriteRequestBody(raw).body).toBe(raw);
  });

  it("does not touch thinking that is not type=enabled on opus-4.7", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 1024,
      thinking: { type: "adaptive" },
    });
    expect(rewriteRequestBody(raw).body).toBe(raw);
  });

  it("applies both rules together when both apply", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      thinking: { type: "enabled" },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.max_tokens).toBe(16384);
    expect(sent.thinking).toEqual({ type: "adaptive" });
    expect(sent.output_config).toEqual({ effort: "medium" });
  });

  // ---------------------------------------------------------------------------
  // 1M / fast-mode model variant resolution from anthropic-beta header.
  //
  // Copilot upstream rejects `context-1m-*` / `fast-mode-*` betas (verified
  // 2026-04: 400 "unsupported beta header(s)") but selects the same variants
  // when the model name carries a `-1m` / `-fast` suffix.
  // ---------------------------------------------------------------------------
  it("appends -1m suffix when context-1m beta is present", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6",
      max_tokens: 1024,
    });
    const result = rewriteRequestBody(raw, "context-1m-2025-08-07");
    const sent = JSON.parse(result.body);
    expect(sent.model).toBe("claude-opus-4.6-1m");
    expect(result.model).toBe("claude-opus-4.6-1m");
  });

  it("appends -fast suffix when fast-mode beta is present", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6",
      max_tokens: 1024,
    });
    const sent = JSON.parse(
      rewriteRequestBody(raw, "fast-mode-2025-09-01").body
    );
    expect(sent.model).toBe("claude-opus-4.6-fast");
  });

  it("appends both -1m and -fast suffixes when both betas are present", () => {
    const raw = JSON.stringify({
      model: "fake-model",
      max_tokens: 1024,
    });
    const sent = JSON.parse(
      rewriteRequestBody(raw, "context-1m-2025-08-07,fast-mode-2025-09-01").body
    );
    expect(sent.model).toBe("fake-model-1m-fast");
  });

  it("ignores variant betas when no model is present", () => {
    const raw = JSON.stringify({ max_tokens: 1024 });
    const result = rewriteRequestBody(raw, "context-1m-2025-08-07");
    const sent = JSON.parse(result.body);
    expect(sent.model).toBeUndefined();
    expect(result.model).toBeUndefined();
  });

  it("does not double-append -1m when model already ends with -1m", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6-1m",
      max_tokens: 1024,
    });
    expect(rewriteRequestBody(raw, "context-1m-2025-08-07").body).toBe(raw);
  });

  it("does not touch model when only unrelated betas are present", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6",
      max_tokens: 1024,
    });
    expect(rewriteRequestBody(raw, "context-management-2025-06-27").body).toBe(
      raw
    );
  });

  it("ignores beta tokens with whitespace", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6",
      max_tokens: 1024,
    });
    const sent = JSON.parse(
      rewriteRequestBody(raw, " context-1m-2025-08-07 , unknown ").body
    );
    expect(sent.model).toBe("claude-opus-4.6-1m");
  });

  it("returned model field reflects resolved variant for downstream use", () => {
    // The handler passes RewriteResult.model into filterAnthropicBeta,
    // which checks `startsWith("claude-opus-4.7")` — verify the suffix
    // doesn't break that match.
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      thinking: { type: "enabled" },
    });
    const result = rewriteRequestBody(raw, "context-1m-2025-08-07");
    expect(result.model).toBe("claude-opus-4.7-1m");
    expect(result.model?.startsWith("claude-opus-4.7")).toBe(true);
  });
});
