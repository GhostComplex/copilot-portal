/**
 * E2E — probes api.githubcopilot.com directly (bypassing the proxy filter)
 * to verify which anthropic-beta + model + thinking combinations the upstream
 * supports or rejects.
 *
 * Requires GITHUB_TOKEN.  Does NOT require a running local proxy.
 *
 * Run:
 *   cd packages/core
 *   GITHUB_TOKEN=gho_xxx npx vitest run --project e2e tests/e2e/ghc-upstream.e2e.test.ts
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { getCopilotToken, createMessages } from "../../src/services/copilot";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let copilotToken: string;

async function postUpstream(opts: {
  model: string;
  beta?: string;
  body?: Record<string, unknown>;
}) {
  const body = JSON.stringify({
    model: opts.model,
    max_tokens: 16384,
    stream: false,
    messages: [{ role: "user", content: "hi" }],
    ...opts.body,
  });
  return createMessages(copilotToken, body, opts.beta);
}

describe("GHC upstream: anthropic-beta + thinking support matrix", () => {
  beforeAll(async () => {
    if (!GITHUB_TOKEN) {
      throw new Error(
        "GITHUB_TOKEN missing — set in packages/core/tests/e2e/.env.test."
      );
    }
    copilotToken = await getCopilotToken(GITHUB_TOKEN);
  }, 30000);
  beforeEach(async () => {
    await sleep(2000);
  });

  // --- context-1m beta: always rejected ---

  it("4.6 + context-1m-2025-08-07 → rejected", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.6",
      beta: "context-1m-2025-08-07",
    });
    expect(res.status).not.toBe(200);
  });

  // --- thinking.type=enabled: only rejected on 4.7 ---

  it("4.6 + enabled (no beta) → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.6",
      body: { thinking: { type: "enabled", budget_tokens: 5000 } },
    });
    expect(res.status).toBe(200);
  });

  it("4.7 + enabled (no beta) → rejected", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      body: { thinking: { type: "enabled", budget_tokens: 5000 } },
    });
    expect(res.status).not.toBe(200);
  });

  // --- thinking.type=adaptive: accepted on all models ---

  it("4.6 + adaptive (no beta) → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.6",
      body: {
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      },
    });
    expect(res.status).toBe(200);
  });

  it("4.7 + adaptive (no beta) → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      body: {
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      },
    });
    expect(res.status).toBe(200);
  });

  // --- interleaved-thinking beta: accepted on all models ---

  it("4.6 + interleaved-thinking (no thinking) → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.6",
      beta: "interleaved-thinking-2025-05-14",
    });
    expect(res.status).toBe(200);
  });

  it("4.7 + interleaved-thinking (no thinking) → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      beta: "interleaved-thinking-2025-05-14",
    });
    expect(res.status).toBe(200);
  });

  // --- interleaved-thinking + adaptive: accepted on all models ---

  it("4.6 + interleaved-thinking + adaptive → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.6",
      beta: "interleaved-thinking-2025-05-14",
      body: {
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
      },
    });
    expect(res.status).toBe(200);
  });

  it("4.7 + interleaved-thinking + adaptive → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      beta: "interleaved-thinking-2025-05-14",
      body: {
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
      },
    });
    expect(res.status).toBe(200);
  });

  // --- interleaved-thinking + enabled: only rejected on 4.7 ---

  it("4.6 + interleaved-thinking + enabled → 200", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.6",
      beta: "interleaved-thinking-2025-05-14",
      body: { thinking: { type: "enabled", budget_tokens: 5000 } },
    });
    expect(res.status).toBe(200);
  });

  it("4.7 + interleaved-thinking + enabled → rejected", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      beta: "interleaved-thinking-2025-05-14",
      body: { thinking: { type: "enabled", budget_tokens: 5000 } },
    });
    expect(res.status).not.toBe(200);
  });

  // --- structured outputs (output_config.format): does header or body trigger 400? ---

  const jsonFormat = {
    type: "json_schema",
    name: "answer",
    schema: {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    },
  };

  it("4.7 + output_config.format (no beta) → rejected (body alone triggers 400)", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      body: { output_config: { format: jsonFormat } },
    });
    expect(res.status).not.toBe(200);
  });

  it("4.7 + structured-outputs beta only (no body) → 200 (header is harmless)", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      beta: "structured-outputs-2025-11-13",
    });
    expect(res.status).toBe(200);
  });

  it("4.7 + output_config.format + structured-outputs beta → rejected", async () => {
    const res = await postUpstream({
      model: "claude-opus-4.7",
      beta: "structured-outputs-2025-11-13",
      body: { output_config: { format: jsonFormat } },
    });
    expect(res.status).not.toBe(200);
  });
});
