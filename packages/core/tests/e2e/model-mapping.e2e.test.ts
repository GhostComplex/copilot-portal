/**
 * E2E — locks the current /v1/messages model+beta → upstream behavior.
 *
 * Hits the proxy at localhost:3000 (override with E2E_BASE_URL) which forwards
 * to api.githubcopilot.com. Requires GITHUB_TOKEN.
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

describe("E2E: /v1/messages model + beta mapping (snapshot 2026-04-19)", () => {
  beforeAll(async () => {
    if (!GITHUB_TOKEN) {
      throw new Error(
        "GITHUB_TOKEN missing — set in packages/core/tests/e2e/.env.test."
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

  // --- baselines: dot form, no beta ---

  it("claude-opus-4.6 (dot, no beta) → 200", async () => {
    const res = await postMessages({ model: "claude-opus-4.6" });
    expect(res.status).toBe(200);
  });

  it("claude-opus-4.7 (dot, no beta) → 200", async () => {
    const res = await postMessages({ model: "claude-opus-4.7" });
    expect(res.status).toBe(200);
  });

  // --- universally-supported betas survive the filter ---

  it("claude-opus-4.6 + context-management beta → 200 (forwarded)", async () => {
    const res = await postMessages({
      model: "claude-opus-4.6",
      beta: "context-management-2025-06-27",
    });
    expect(res.status).toBe(200);
  });
});
