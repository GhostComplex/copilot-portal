/**
 * E2E tests — hit real Copilot API through the proxy.
 * Requires GITHUB_TOKEN in .env.test or environment.
 * Runs serially to avoid rate-limiting.
 */

import { describe, it, expect, beforeEach } from "vitest";
import app from "../../src/index";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const authHeader = { Authorization: `Bearer ${GITHUB_TOKEN}` };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!GITHUB_TOKEN)("E2E: real Copilot API", () => {
  // 2s delay between tests to avoid rate-limiting
  beforeEach(async () => {
    await sleep(2000);
  });
  // --- Models ---

  it("GET /v1/models returns model list", async () => {
    const res = await app.request("/v1/models", {
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
    const res = await app.request("/v1/chat/completions", {
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
    const res = await app.request("/v1/chat/completions", {
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
    const res = await app.request("/v1/messages", {
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

  it("POST /v1/messages streaming", async () => {
    const res = await app.request("/v1/messages", {
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
});
