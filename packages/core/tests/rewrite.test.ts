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
});
