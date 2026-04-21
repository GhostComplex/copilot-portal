import { describe, it, expect } from "vitest";
import {
  rewriteRequestBody,
  filterAnthropicBeta,
} from "../src/routes/messages/translate";

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

  it("rewrites thinking.type=enabled → adaptive on claude-opus-4.7", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.thinking).toEqual({ type: "adaptive" });
  });

  it("does not inject output_config.effort when rewriting thinking", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.output_config).toBeUndefined();
  });

  it("preserves client-provided output_config.effort", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
      output_config: { effort: "high" },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.output_config).toEqual({ effort: "high" });
  });

  it("leaves thinking.type=enabled untouched on claude-opus-4.6", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
  });

  it("leaves thinking.type=adaptive untouched on claude-opus-4.7", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "adaptive" },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.thinking).toEqual({ type: "adaptive" });
  });

  it("strips output_config.format but keeps effort", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: { type: "object" } },
      },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect(sent.output_config).toEqual({ effort: "high" });
  });

  it("removes output_config entirely when format was the only key", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      output_config: {
        format: { type: "json_schema", schema: { type: "object" } },
      },
    });
    const sent = JSON.parse(rewriteRequestBody(raw).body);
    expect("output_config" in sent).toBe(false);
  });
});

describe("filterAnthropicBeta", () => {
  it("returns undefined for empty input", () => {
    expect(filterAnthropicBeta(undefined)).toBeUndefined();
    expect(filterAnthropicBeta(null)).toBeUndefined();
    expect(filterAnthropicBeta("")).toBeUndefined();
  });

  it("keeps supported betas", () => {
    expect(
      filterAnthropicBeta(
        "context-management-2025-06-27,advanced-tool-use-2025-11-20"
      )
    ).toBe("context-management-2025-06-27,advanced-tool-use-2025-11-20");
  });

  it("passes through unknown betas", () => {
    expect(filterAnthropicBeta("some-unknown-beta")).toBe("some-unknown-beta");
  });

  it("passes through interleaved-thinking beta", () => {
    expect(filterAnthropicBeta("interleaved-thinking-2025-05-14")).toBe(
      "interleaved-thinking-2025-05-14"
    );
  });

  it("drops context-1m beta", () => {
    expect(filterAnthropicBeta("context-1m-2025-08-07")).toBeUndefined();
  });

  it("drops context-1m but keeps other betas", () => {
    expect(
      filterAnthropicBeta("context-1m-2025-08-07,context-management-2025-06-27")
    ).toBe("context-management-2025-06-27");
  });

  it("trims whitespace around entries", () => {
    expect(
      filterAnthropicBeta(" context-management-2025-06-27 , some-other-beta ")
    ).toBe("context-management-2025-06-27,some-other-beta");
  });
});
