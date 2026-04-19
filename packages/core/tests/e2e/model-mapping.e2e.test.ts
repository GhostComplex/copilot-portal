/**
 * E2E — locks the current /v1/messages model+beta → upstream model mapping.
 *
 * Hits the proxy at localhost:3000 (override with E2E_BASE_URL) which forwards
 * to api.githubcopilot.com. Requires GITHUB_TOKEN.
 *
 * Snapshot of upstream behavior taken 2026-04-19. See docs/model-mapping.md
 * for the mapping rules and the bugs this test pins. If a case here flips
 * (e.g. a 404 starts returning 200), upstream has either added a new model
 * id or changed naming — update the docs and the test together.
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
      await fetch(baseUrl + "/health");
    } catch {
      throw new Error(
        `Backend not reachable at ${baseUrl} — start it with \`pnpm dev\`.`
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

  // --- 1m: only claude-opus-4.6 has a -1m variant upstream ---

  it("claude-opus-4.6 + context-1m beta → 200 (rewritten to -1m)", async () => {
    const res = await postMessages({
      model: "claude-opus-4.6",
      beta: "context-1m-2025-08-07",
    });
    expect(res.status).toBe(200);
    // 200 alone proves the rewrite worked: posting `claude-opus-4.6` with
    // the beta unchanged would 400, but posting `claude-opus-4.6-1m`
    // succeeds. Upstream may canonicalize the echoed `model` field
    // (observed: returns dash form), so don't assert on it.
  });

  // BUG 1 (dash/dot mismatch): Claude Code sends dash form; we naively
  // append `-1m`, producing a model id upstream does not have.
  it("BUG: claude-opus-4-6 (dash) + context-1m beta → 4xx (broken)", async () => {
    const res = await postMessages({
      model: "claude-opus-4-6",
      beta: "context-1m-2025-08-07",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // BUG 2 (blanket suffix): every model gets `-1m` if the beta is present,
  // but only claude-opus-4.6 has a -1m variant in the catalog.
  it("BUG: claude-opus-4.7 + context-1m beta → 4xx (no 4.7-1m exists)", async () => {
    const res = await postMessages({
      model: "claude-opus-4.7",
      beta: "context-1m-2025-08-07",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("BUG: claude-sonnet-4.5 + context-1m beta → 4xx (no sonnet-1m exists)", async () => {
    const res = await postMessages({
      model: "claude-sonnet-4.5",
      beta: "context-1m-2025-08-07",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // BUG 3 (dead -fast branch): catalog has no -fast variants at all.
  it("BUG: claude-opus-4.6 + fast-mode-* beta → 4xx (no -fast in catalog)", async () => {
    const res = await postMessages({
      model: "claude-opus-4.6",
      beta: "fast-mode-2025-01-01",
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
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
