import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { health, chatCompletions, notFound } from "../src/handlers";

// Mock copilot module
vi.mock("../src/copilot", () => ({
  getCopilotToken: vi.fn(),
  forwardChatCompletions: vi.fn(),
  TokenExchangeError: class TokenExchangeError extends Error {
    constructor(
      message: string,
      public statusCode: number,
    ) {
      super(message);
      this.name = "TokenExchangeError";
    }
  },
}));

import { getCopilotToken, forwardChatCompletions, TokenExchangeError } from "../src/copilot";

const mockGetCopilotToken = getCopilotToken as ReturnType<typeof vi.fn>;
const mockForwardChatCompletions = forwardChatCompletions as ReturnType<typeof vi.fn>;

describe("health handler", () => {
  it("returns status ok", async () => {
    const app = new Hono();
    app.get("/health", health);

    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});

describe("notFound handler", () => {
  it("returns 404 with error message", async () => {
    const app = new Hono();
    app.all("*", notFound);

    const res = await app.request("/nonexistent");
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body).toEqual({ error: "Not found" });
  });
});

describe("chatCompletions handler", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.post("/v1/chat/completions", chatCompletions);
    vi.clearAllMocks();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ messages: [] }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Authorization");
  });

  it("returns error when token exchange fails", async () => {
    mockGetCopilotToken.mockRejectedValue(new TokenExchangeError("Invalid token", 401));

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer ghp_test123" },
      body: JSON.stringify({ messages: [] }),
    });

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("Token exchange failed");
  });

  it("forwards request to Copilot API on success", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token-123");
    mockForwardChatCompletions.mockResolvedValue(
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer ghp_test123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "gpt-4", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(res.status).toBe(200);
    expect(mockGetCopilotToken).toHaveBeenCalledWith("ghp_test123");
    expect(mockForwardChatCompletions).toHaveBeenCalledWith(
      "copilot-token-123",
      expect.any(String),
    );
  });

  it("handles streaming responses", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token-123");
    mockForwardChatCompletions.mockResolvedValue(
      new Response("data: test\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }),
    );

    const res = await app.request("/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer ghp_test123" },
      body: JSON.stringify({ stream: true, messages: [] }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
  });
});
