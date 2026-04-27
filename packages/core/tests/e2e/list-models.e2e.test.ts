/**
 * E2E — list available models from both the proxy and the upstream Copilot API.
 *
 * Requires GITHUB_TOKEN in tests/e2e/.env.test or environment.
 * The proxy test also requires a running backend (`pnpm dev`).
 *
 * Run:
 *   cd packages/core
 *   npx vitest run --project e2e tests/e2e/list-models.e2e.test.ts
 */
import { describe, it, beforeAll } from "vitest";
import { getCopilotToken, getModels } from "../../src/services/copilot";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";

describe("list models", () => {
  beforeAll(() => {
    if (!GITHUB_TOKEN) {
      throw new Error(
        "GITHUB_TOKEN missing — set in packages/core/tests/e2e/.env.test."
      );
    }
  });

  it("upstream (api.githubcopilot.com)", async () => {
    const copilotToken = await getCopilotToken(GITHUB_TOKEN!);
    const res = await getModels(copilotToken);
    const json = (await res.json()) as { data: { id: string }[] };
    const ids = json.data.map((m) => m.id).sort();
    console.log("\n=== Upstream models ===");
    for (const id of ids) console.log(id);
  });

  it("proxy (/v1/models)", async () => {
    const res = await fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}` },
    });
    const json = (await res.json()) as { data: { id: string }[] };
    const ids = json.data.map((m) => m.id).sort();
    console.log("\n=== Proxy models ===");
    for (const id of ids) console.log(id);
  });
});
