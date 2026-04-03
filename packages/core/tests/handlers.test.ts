import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/index";

// Mock services
vi.mock("../src/services/copilot", () => ({
  getCopilotToken: vi.fn(),
  createChatCompletions: vi.fn(),
  getModels: vi.fn(),
  clearTokenCache: vi.fn(),
  isTokenValid: vi.fn(),
  TokenExchangeError: class TokenExchangeError extends Error {
    statusCode: number;
    constructor(message: string, statusCode: number) {
      super(message);
      this.statusCode = statusCode;
    }
  },
}));

import {
  getCopilotToken,
  createChatCompletions,
  getModels,
  TokenExchangeError,
} from "../src/services/copilot";

const mockGetCopilotToken = getCopilotToken as ReturnType<typeof vi.fn>;
const mockCreateChatCompletions = createChatCompletions as ReturnType<
  typeof vi.fn
>;
const mockGetModels = getModels as ReturnType<typeof vi.fn>;

describe("GET /health", () => {
  it("returns ok status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /v1/models", () => {
  beforeEach(() => {
    mockGetCopilotToken.mockReset();
    mockGetModels.mockReset();
  });

  it("returns 401 without auth header", async () => {
    const res = await app.request("/v1/models");
    expect(res.status).toBe(401);
  });

  it("returns list of models with valid auth", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockGetModels.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "claude-opus-4", object: "model", vendor: "anthropic" },
            { id: "gpt-4o", object: "model", vendor: "openai" },
          ],
        }),
        { status: 200 }
      )
    );

    const res = await app.request("/v1/models", {
      headers: { Authorization: "Bearer ghu_test" },
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe("list");
    expect(data.data).toContainEqual({
      id: "claude-opus-4",
      object: "model",
      vendor: "anthropic",
    });
  });
});

describe("POST /v1/chat/completions", () => {
  beforeEach(() => {
    mockGetCopilotToken.mockReset();
    mockCreateChatCompletions.mockReset();
  });

  it("returns 401 without auth header", async () => {
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("forwards request on valid auth", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateChatCompletions.mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), {
        headers: { "Content-Type": "application/json" },
      })
    );

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer github-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4", messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(mockGetCopilotToken).toHaveBeenCalledWith("github-token");
  });

  it("returns error on token exchange failure", async () => {
    mockGetCopilotToken.mockRejectedValue(
      new TokenExchangeError("Invalid token", 401)
    );

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer bad-token" },
      body: "{}",
    });

    expect(res.status).toBe(401);
  });
});

describe("404 fallback", () => {
  it("returns 404 for unknown routes", async () => {
    const res = await app.request("/unknown");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
});
