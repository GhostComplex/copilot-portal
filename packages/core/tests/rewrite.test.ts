import { describe, it, expect } from "vitest";
import {
  transformRequestBody,
  rewriteContext1m,
  rewriteRequest,
} from "../src/routes/messages/rewrite";

describe("transformRequestBody", () => {
  it("returns raw body and undefined model on invalid JSON", () => {
    const raw = "not json";
    const result = transformRequestBody(raw);
    expect(result.body).toBe(raw);
    expect(result.model).toBeUndefined();
  });

  it("extracts model from parsed body", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
    });
    expect(transformRequestBody(raw).model).toBe("claude-sonnet-4");
  });

  it("returns undefined model when field is missing or non-string", () => {
    expect(
      transformRequestBody(JSON.stringify({ max_tokens: 1024 })).model
    ).toBeUndefined();
    expect(
      transformRequestBody(JSON.stringify({ model: 42, max_tokens: 1024 }))
        .model
    ).toBeUndefined();
  });

  it("returns the raw string unchanged when no rewrites apply", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
    });
    expect(transformRequestBody(raw).body).toBe(raw);
  });

  it("injects default max_tokens when missing", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "hi" }],
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect(sent.max_tokens).toBe(16384);
  });

  it("preserves caller-provided max_tokens", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 42,
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect(sent.max_tokens).toBe(42);
  });

  it("rewrites thinking.type=enabled → adaptive on claude-opus-4.7", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect(sent.thinking).toEqual({ type: "adaptive" });
  });

  it("does not inject output_config.effort when rewriting thinking", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect(sent.output_config).toBeUndefined();
  });

  it("preserves client-provided output_config.effort", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
      output_config: { effort: "high" },
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect(sent.output_config).toEqual({ effort: "high" });
  });

  it("leaves thinking.type=enabled untouched on claude-opus-4.6", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.6",
      max_tokens: 16384,
      thinking: { type: "enabled", budget_tokens: 5000 },
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect(sent.thinking).toEqual({ type: "enabled", budget_tokens: 5000 });
  });

  it("leaves thinking.type=adaptive untouched on claude-opus-4.7", () => {
    const raw = JSON.stringify({
      model: "claude-opus-4.7",
      max_tokens: 16384,
      thinking: { type: "adaptive" },
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect(sent.thinking).toEqual({ type: "adaptive" });
  });

  it("strips context_management from body", () => {
    const raw = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      context_management: { type: "auto" },
    });
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect("context_management" in sent).toBe(false);
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
    const sent = JSON.parse(transformRequestBody(raw).body);
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
    const sent = JSON.parse(transformRequestBody(raw).body);
    expect("output_config" in sent).toBe(false);
  });
});

describe("rewriteContext1m", () => {
  const body46 = JSON.stringify({
    model: "claude-opus-4.6",
    max_tokens: 16384,
  });
  const body47 = JSON.stringify({
    model: "claude-opus-4.7",
    max_tokens: 16384,
  });

  it("passes input through unchanged when context-1m beta is absent", () => {
    const input = { headers: {}, body: body47 };
    expect(rewriteContext1m(input)).toEqual(input);
  });

  it("rewrites claude-opus-4.6 → claude-opus-4.6-1m and strips beta", () => {
    const out = rewriteContext1m({
      headers: { "anthropic-beta": "context-1m-2025-08-07" },
      body: body46,
    });
    expect(out.headers["anthropic-beta"]).toBeUndefined();
    expect(JSON.parse(out.body).model).toBe("claude-opus-4.6-1m");
  });

  it("rewrites claude-opus-4.7 → claude-opus-4.7-1m-internal and strips beta", () => {
    const out = rewriteContext1m({
      headers: { "anthropic-beta": "context-1m-2025-08-07" },
      body: body47,
    });
    expect(out.headers["anthropic-beta"]).toBeUndefined();
    expect(JSON.parse(out.body).model).toBe("claude-opus-4.7-1m-internal");
  });

  it("preserves other betas alongside context-1m", () => {
    const out = rewriteContext1m({
      headers: {
        "anthropic-beta": "context-management-2025-06-27,context-1m-2025-08-07",
      },
      body: body47,
    });
    expect(out.headers["anthropic-beta"]).toBe("context-management-2025-06-27");
    expect(JSON.parse(out.body).model).toBe("claude-opus-4.7-1m-internal");
  });

  it("leaves model untouched for unsupported models but still strips beta", () => {
    const out = rewriteContext1m({
      headers: { "anthropic-beta": "context-1m-2025-08-07" },
      body: JSON.stringify({ model: "claude-sonnet-4", max_tokens: 16384 }),
    });
    expect(out.headers["anthropic-beta"]).toBeUndefined();
    expect(JSON.parse(out.body).model).toBe("claude-sonnet-4");
  });

  it("trims whitespace around comma-separated betas", () => {
    const out = rewriteContext1m({
      headers: {
        "anthropic-beta":
          " context-1m-2025-08-07 , context-management-2025-06-27 ",
      },
      body: body47,
    });
    expect(out.headers["anthropic-beta"]).toBe("context-management-2025-06-27");
  });

  it("passes body through unchanged on invalid JSON", () => {
    const out = rewriteContext1m({
      headers: { "anthropic-beta": "context-1m-2025-08-07" },
      body: "not json",
    });
    expect(out.body).toBe("not json");
    expect(out.headers["anthropic-beta"]).toBeUndefined();
  });
});

describe("rewriteRequest (extras)", () => {
  const body = JSON.stringify({
    model: "claude-opus-4.7",
    max_tokens: 16384,
  });

  it("strips context-management-2025-06-27 from anthropic-beta extras", () => {
    const out = rewriteRequest({
      headers: { "anthropic-beta": "context-management-2025-06-27" },
      body,
    });
    expect(out.extras["anthropic-beta"]).toBeUndefined();
  });

  it("strips fine-grained-tool-streaming-2025-05-14 from anthropic-beta extras", () => {
    const out = rewriteRequest({
      headers: { "anthropic-beta": "fine-grained-tool-streaming-2025-05-14" },
      body,
    });
    expect(out.extras["anthropic-beta"]).toBeUndefined();
  });

  it("strips multiple rejected betas in one header", () => {
    const out = rewriteRequest({
      headers: {
        "anthropic-beta":
          "context-management-2025-06-27,fine-grained-tool-streaming-2025-05-14,interleaved-thinking-2025-05-14",
      },
      body,
    });
    expect(out.extras["anthropic-beta"]).toBe(
      "interleaved-thinking-2025-05-14"
    );
  });

  it("keeps other betas alongside stripping context-management", () => {
    const out = rewriteRequest({
      headers: {
        "anthropic-beta":
          "context-management-2025-06-27,interleaved-thinking-2025-05-14",
      },
      body,
    });
    expect(out.extras["anthropic-beta"]).toBe(
      "interleaved-thinking-2025-05-14"
    );
  });

  it("forwards unrelated betas unchanged", () => {
    const out = rewriteRequest({
      headers: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
      body,
    });
    expect(out.extras["anthropic-beta"]).toBe(
      "interleaved-thinking-2025-05-14"
    );
  });

  it("omits anthropic-beta from extras when no header was sent", () => {
    const out = rewriteRequest({ headers: {}, body });
    expect("anthropic-beta" in out.extras).toBe(false);
  });
});
