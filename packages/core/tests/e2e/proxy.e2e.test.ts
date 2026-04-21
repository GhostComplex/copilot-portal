/**
 * E2E — test the proxy running on localhost.
 *
 * Requires a running backend (`pnpm dev`) and GITHUB_TOKEN in
 * tests/e2e/.env.test or environment.
 *
 * Run:
 *   cd packages/core
 *   GITHUB_TOKEN=gho_xxx npx vitest run --project e2e tests/e2e/proxy.e2e.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const authHeader = { Authorization: `Bearer ${GITHUB_TOKEN}` };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postMessages(opts: {
  model: string;
  beta?: string;
  body?: Record<string, unknown>;
}) {
  const headers: Record<string, string> = {
    ...authHeader,
    "Content-Type": "application/json",
  };
  if (opts.beta) headers["anthropic-beta"] = opts.beta;
  return fetch(baseUrl + "/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 8,
      stream: false,
      messages: [{ role: "user", content: "hi" }],
      ...opts.body,
    }),
  });
}

describe("E2E: proxy (localhost)", () => {
  beforeAll(async () => {
    if (!GITHUB_TOKEN) {
      throw new Error(
        "GITHUB_TOKEN missing — set in packages/core/tests/e2e/.env.test or export in shell."
      );
    }
    try {
      const res = await fetch(baseUrl + "/health");
      if (!res.ok) {
        throw new Error(
          `Backend at ${baseUrl} returned ${res.status} on /health.`
        );
      }
    } catch (err) {
      throw new Error(
        `Backend not reachable at ${baseUrl} — start it with \`pnpm dev\`. (${(err as Error).message})`
      );
    }
  });
  beforeEach(async () => {
    await sleep(2000);
  });

  // --- Models ---

  it("GET /v1/models returns model list", async () => {
    const res = await fetch(baseUrl + "/v1/models", { headers: authHeader });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("list");
    expect(data.data.length).toBeGreaterThan(0);
    expect(data.data[0]).toHaveProperty("id");
  });

  // --- Chat Completions ---

  it("POST /v1/chat/completions non-streaming", async () => {
    const res = await fetch(baseUrl + "/v1/chat/completions", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 10,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.choices[0].message.content).toBeTruthy();
  });

  it("POST /v1/chat/completions streaming", async () => {
    const res = await fetch(baseUrl + "/v1/chat/completions", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say hi." }],
        max_tokens: 10,
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("data:");
    expect(text).toContain("[DONE]");
  });

  // --- Messages (Anthropic-compatible) ---

  it("POST /v1/messages non-streaming", async () => {
    const res = await postMessages({ model: "claude-sonnet-4" });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("message");
    expect(data.content[0].type).toBe("text");
  });

  it("POST /v1/messages without max_tokens uses default", async () => {
    const res = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        stream: false,
        messages: [{ role: "user", content: "Say hello in one word." }],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("message");
  });

  it("POST /v1/messages streaming", async () => {
    const res = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        max_tokens: 10,
        stream: true,
        messages: [{ role: "user", content: "Say hi." }],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("message_start");
    expect(text).toContain("message_stop");
  });

  // --- Messages: model + beta mapping ---

  it("claude-opus-4.6 (no beta) → 200", async () => {
    const res = await postMessages({ model: "claude-opus-4.6" });
    expect(res.status).toBe(200);
  });

  it("claude-opus-4.7 (no beta) → 200", async () => {
    const res = await postMessages({ model: "claude-opus-4.7" });
    expect(res.status).toBe(200);
  });

  it("context-management beta forwarded → 200", async () => {
    const res = await postMessages({
      model: "claude-opus-4.6",
      beta: "context-management-2025-06-27",
    });
    expect(res.status).toBe(200);
  });

  it("context-1m beta stripped by filter → 200", async () => {
    const res = await postMessages({
      model: "claude-opus-4.6",
      beta: "context-1m-2025-08-07",
    });
    expect(res.status).toBe(200);
  });

  // --- Responses (OpenAI Responses API) ---

  it("POST /v1/responses non-streaming", async () => {
    const res = await fetch(baseUrl + "/v1/responses", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: [{ role: "user", content: "Say hello in one word." }],
        stream: false,
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("id");
  });

  it("POST /v1/responses streaming", async () => {
    const res = await fetch(baseUrl + "/v1/responses", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: [{ role: "user", content: "Say hi." }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("event: response.created");
    expect(text).toContain("event: response.completed");
  });

  // --- Embeddings ---

  it("POST /v1/embeddings", async () => {
    const res = await fetch(baseUrl + "/v1/embeddings", {
      method: "POST",
      headers: { ...authHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: ["hello world"],
      }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.data[0].embedding.length).toBeGreaterThan(0);
  });
});
