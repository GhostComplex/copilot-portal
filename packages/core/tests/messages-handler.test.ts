/**
 * Tests for POST /v1/messages — Anthropic Messages API passthrough
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import app from "../src/index";

// Mock network-touching services; keep pure helpers (TokenExchangeError)
// from the real module so tests exercise real logic.
vi.mock("../src/services/copilot", async (importActual) => {
  const actual = await importActual<typeof import("../src/services/copilot")>();
  return {
    ...actual,
    getCopilotToken: vi.fn(),
    createChatCompletions: vi.fn(),
    createMessages: vi.fn(),
    searchViaResponses: vi.fn(),
    getModels: vi.fn(),
  };
});

import {
  getCopilotToken,
  createMessages,
  searchViaResponses,
  TokenExchangeError,
} from "../src/services/copilot";

const mockGetCopilotToken = getCopilotToken as ReturnType<typeof vi.fn>;
const mockCreateMessages = createMessages as ReturnType<typeof vi.fn>;
const mockSearch = searchViaResponses as ReturnType<typeof vi.fn>;

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
    mockCreateMessages.mockReset();
    mockSearch.mockReset();
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

  // --- Upstream error ---

  it("returns upstream error status on non-ok response", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateMessages.mockResolvedValue(
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

  // --- Passthrough: non-streaming ---

  it("passes through upstream JSON response unchanged", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");

    const upstreamBody = {
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [{ type: "text", text: "Hi there!" }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    };

    mockCreateMessages.mockResolvedValue(
      new Response(JSON.stringify(upstreamBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const res = await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const data = await res.json();
    expect(data).toEqual(upstreamBody);
  });

  it("forwards request body to upstream unchanged", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateMessages.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const bodyWithThinking = JSON.stringify({
      model: "claude-sonnet-4",
      max_tokens: 1024,
      thinking: { type: "enabled", budget_tokens: 5000 },
      messages: [
        { role: "user", content: "Hello" },
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "...", signature: "abc123" },
            { type: "text", text: "Hi" },
          ],
        },
        { role: "user", content: "Follow up" },
      ],
    });

    await app.request(
      "/v1/messages",
      makeRequest(bodyWithThinking, { Authorization: "Bearer ghu_test" })
    );

    expect(mockCreateMessages).toHaveBeenCalledWith(
      "copilot-token",
      bodyWithThinking,
      expect.any(Object)
    );
  });

  it("injects default max_tokens when missing", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateMessages.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const bodyWithoutMaxTokens = JSON.stringify({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
    });

    await app.request(
      "/v1/messages",
      makeRequest(bodyWithoutMaxTokens, { Authorization: "Bearer ghu_test" })
    );

    const sentBody = JSON.parse(mockCreateMessages.mock.calls[0][1]);
    expect(sentBody.max_tokens).toBe(16384);
    expect(sentBody.model).toBe("claude-sonnet-4");
    expect(sentBody.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  // --- anthropic-beta header forwarding ---

  it("forwards allowed anthropic-beta values to upstream", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateMessages.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, {
        Authorization: "Bearer ghu_test",
        "anthropic-beta":
          "context-management-2025-06-27, some-unknown-beta, interleaved-thinking-2025-05-14",
      })
    );

    expect(mockCreateMessages).toHaveBeenCalledWith(
      "copilot-token",
      expect.any(String),
      expect.objectContaining({
        "anthropic-beta":
          "context-management-2025-06-27, some-unknown-beta, interleaved-thinking-2025-05-14",
      })
    );
  });

  it("passes undefined anthropic-beta when header absent", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateMessages.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, { Authorization: "Bearer ghu_test" })
    );

    const headers = mockCreateMessages.mock.calls[0][2] as Record<
      string,
      string | undefined
    >;
    expect(headers["anthropic-beta"]).toBeUndefined();
  });

  it("forwards unknown betas to upstream", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateMessages.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, {
        Authorization: "Bearer ghu_test",
        "anthropic-beta": "unknown-beta-1, unknown-beta-2",
      })
    );

    expect(mockCreateMessages).toHaveBeenCalledWith(
      "copilot-token",
      expect.any(String),
      expect.objectContaining({
        "anthropic-beta": "unknown-beta-1, unknown-beta-2",
      })
    );
  });

  // --- Passthrough: streaming ---

  it("passes through SSE stream unchanged", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");

    const sseData =
      'event: message_start\ndata: {"type":"message_start"}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta"}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n';

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(sseData));
        controller.close();
      },
    });

    mockCreateMessages.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })
    );

    const res = await app.request(
      "/v1/messages",
      makeRequest(validAnthropicBody, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(res.headers.get("Connection")).toBe("keep-alive");

    const text = await res.text();
    expect(text).toContain("message_start");
    expect(text).toContain("content_block_delta");
    expect(text).toContain("message_stop");
  });

  // --- Server-tool interception (web search) ---

  it("intercepts web_search tool and returns search results (non-streaming)", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");

    mockCreateMessages
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4.6",
            content: [
              {
                type: "tool_use",
                id: "tu_1",
                name: "web_search",
                input: { query: "AI news" },
              },
            ],
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_2",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4.6",
            content: [{ type: "text", text: "Here are the results." }],
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    mockSearch.mockResolvedValue([
      { url: "https://example.com", title: "AI News", snippet: "Latest AI" },
    ]);

    const body = JSON.stringify({
      model: "claude-sonnet-4.6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Search for AI news" }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    });

    const res = await app.request(
      "/v1/messages",
      makeRequest(body, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.content[0].text).toBe("Here are the results.");
    expect(mockSearch).toHaveBeenCalledWith("copilot-token", "AI news");
  });

  it("intercepts web_search tool and returns SSE when stream=true", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");

    mockCreateMessages
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_1",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4.6",
            content: [
              {
                type: "tool_use",
                id: "tu_1",
                name: "web_search",
                input: { query: "test" },
              },
            ],
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: "msg_2",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-4.6",
            content: [{ type: "text", text: "Results here." }],
            stop_reason: "end_turn",
            usage: { input_tokens: 50, output_tokens: 20 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

    mockSearch.mockResolvedValue([]);

    const body = JSON.stringify({
      model: "claude-sonnet-4.6",
      max_tokens: 1024,
      stream: true,
      messages: [{ role: "user", content: "search" }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });

    const res = await app.request(
      "/v1/messages",
      makeRequest(body, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await res.text();
    expect(text).toContain("message_start");
    expect(text).toContain("content_block_start");
    expect(text).toContain("text_delta");
    expect(text).toContain("message_stop");
    expect(text).not.toContain("[DONE]");
  });

  it("passes through without interception when no server tools", async () => {
    mockGetCopilotToken.mockResolvedValue("copilot-token");
    mockCreateMessages.mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const body = JSON.stringify({
      model: "claude-sonnet-4.6",
      max_tokens: 1024,
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", name: "f1", input_schema: {} }],
    });

    const res = await app.request(
      "/v1/messages",
      makeRequest(body, { Authorization: "Bearer ghu_test" })
    );
    expect(res.status).toBe(200);
    expect(mockSearch).not.toHaveBeenCalled();
  });
});
