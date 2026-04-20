/**
 * E2E tests — hit real Copilot API through the proxy running on localhost:3000.
 * Start the backend first with `pnpm dev`. Requires GITHUB_TOKEN in
 * tests/e2e/.env.test or environment. Runs serially to avoid rate-limiting.
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const authHeader = { Authorization: `Bearer ${GITHUB_TOKEN}` };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("E2E: real Copilot API", () => {
  beforeAll(async () => {
    if (!GITHUB_TOKEN) {
      throw new Error(
        "GITHUB_TOKEN missing — set it in packages/core/tests/e2e/.env.test or export in shell."
      );
    }
    try {
      await fetch(baseUrl + "/health");
    } catch {
      throw new Error(
        `Backend not reachable at ${baseUrl} — start it with \`pnpm dev\` and re-run.`
      );
    }
  });

  // 2s delay between tests to avoid rate-limiting
  beforeEach(async () => {
    await sleep(2000);
  });
  // --- Models ---

  it("GET /v1/models returns model list", async () => {
    const res = await fetch(baseUrl + "/v1/models", {
      headers: authHeader,
    });

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
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Say hello in one word." }],
        max_tokens: 10,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices).toBeDefined();
    expect(data.choices.length).toBeGreaterThan(0);
    expect(data.choices[0].message.content).toBeTruthy();
  });

  it("POST /v1/chat/completions streaming", async () => {
    const res = await fetch(baseUrl + "/v1/chat/completions", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
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
    const res = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        max_tokens: 10,
        stream: false,
        messages: [{ role: "user", content: "Say hello in one word." }],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("message");
    expect(data.role).toBe("assistant");
    expect(data.content.length).toBeGreaterThan(0);
    expect(data.content[0].type).toBe("text");
    expect(data.content[0].text).toBeTruthy();
  });

  it("POST /v1/messages without max_tokens uses default", async () => {
    const res = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        stream: false,
        messages: [{ role: "user", content: "Say hello in one word." }],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("message");
    expect(data.content[0].text).toBeTruthy();
  });

  it("POST /v1/messages streaming", async () => {
    const res = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
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

  it("POST /v1/messages succeeds when context-1m beta header is present", async () => {
    const res = await fetch(baseUrl + "/v1/messages", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
        "anthropic-beta": "context-1m-2025-08-07",
      },
      body: JSON.stringify({
        model: "claude-opus-4.6",
        max_tokens: 10,
        stream: false,
        messages: [{ role: "user", content: "Say hello in one word." }],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("message");
    expect(data.content[0].text).toBeTruthy();
  });

  // --- Responses (OpenAI Responses API) ---

  it("POST /v1/responses non-streaming", async () => {
    const res = await fetch(baseUrl + "/v1/responses", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.4",
        input: [{ role: "user", content: "Say hello in one word." }],
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("created_at");
  });

  it("POST /v1/responses streaming", async () => {
    const res = await fetch(baseUrl + "/v1/responses", {
      method: "POST",
      headers: {
        ...authHeader,
        "Content-Type": "application/json",
      },
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
});
