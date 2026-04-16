/**
 * Tests for POST /v1/messages — Anthropic Messages API handler
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/index";

// Mock services (same pattern as handlers.test.ts)
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
  TokenExchangeError,
} from "../src/services/copilot";

const mockGetCopilotToken = getCopilotToken as ReturnType<typeof vi.fn>;
const mockCreateChatCompletions = createChatCompletions as ReturnType<
  typeof vi.fn
>;

const validAnthropicBody = JSON.stringify({
  model: "claude-sonnet-4",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello" }],
});

function makeRequest(
  body: string,
  headers: Record<string, string> = {}
): RequestInit {
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body,
  };
}

describe("POST /v1/messages", () => {
  beforeEach(() => {
    mockGetCopilotToken.mockReset();
    mockCreateChatCompletions.mockReset();
  });

  // --- Auth ---

  it("returns 401 without auth header", async () => {
    const res = await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody)
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
  });

  it("returns 401 with malformed auth header", async () => {
    const res = await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, { Authorization: "bad" })
    );
    expect(res.status).toBe(401);
  });

  // --- Token exchange ---

  it("returns error on TokenExchangeError", async () => {
    mockGetCopilotToken.mockRejectedValue(
      new TokenExchangeError("Token expired", 403)
    );

    const res = await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toBe("Token expired");
  });

  it("returns 500 on non-TokenExchangeError", async () => {
    mockGetCopilotToken.mockRejectedValue(new Error("network failure"));

    const res = await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(500);
  });

  // --- Invalid body ---

  it("returns 400 on invalid JSON body", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");

    const res = await app.request("/v1/messages", {
      method: "POST",
      headers: {
        Authorization: "Bearer ghu_test",
        "Content-Type": "application/json",
      },
      body: "not json {{{",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.type).toBe("invalid_request_error");
  });

  // --- Upstream error ---

  it("returns upstream error status on non-ok response", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateChatCompletions.mockResolvedValue(
      new Response("rate limited", { status: 429 })
    );

    const res = await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.type).toBe("api_error");
    expect(body.error.message).toBe("rate limited");
  });

  // --- Non-streaming ---

  it("returns translated Anthropic response for non-streaming request", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateChatCompletions.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "chat-123",
          model: "claude-sonnet-4",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Hi there!" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    const body = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      stream: false,
      messages: [{ role: "user", content: "Hello" }],
    });

    const res = await app.request(
      "/v1/messages",
      makeRequest(body, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.type).toBe("message");
    expect(data.role).toBe("assistant");
    expect(data.content).toEqual([{ type: "text", text: "Hi there!" }]);
    expect(data.stop_reason).toBe("end_turn");
    expect(data.usage.input_tokens).toBe(10);
    expect(data.usage.output_tokens).toBe(5);
  });

  // --- Streaming: no body ---

  it("returns 502 when streaming but upstream has no body", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    // Response with null body
    const upstreamResponse = new Response(null, { status: 200 });
    // Override body to be null
    Object.defineProperty(upstreamResponse, "body", { value: null });
    mockCreateChatCompletions.mockResolvedValue(upstreamResponse);

    const body = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "user", content: "Hello" }],
    });

    const res = await app.request(
      "/v1/messages",
      makeRequest(body, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error.type).toBe("api_error");
    expect(data.error.message).toBe("No upstream body");
  });

  // --- Streaming: success ---

  it("streams SSE events for streaming request", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");

    const sseData = [
      `data: ${JSON.stringify({ id: "chat-1", model: "claude-sonnet-4", choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat-1", model: "claude-sonnet-4", choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ id: "chat-1", model: "claude-sonnet-4", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 2 } })}\n\n`,
      `data: [DONE]\n\n`,
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of sseData) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    mockCreateChatCompletions.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );

    const body = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "user", content: "Hello" }],
    });

    const res = await app.request(
      "/v1/messages",
      makeRequest(body, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toContain("message_start");
    expect(text).toContain("content_block_start");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("message_stop");
  });
});
