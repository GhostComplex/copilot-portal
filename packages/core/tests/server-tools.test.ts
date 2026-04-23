/**
 * Tests for web search interception (via /responses).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  hasWebSearchTool,
  withWebSearch,
} from "../src/routes/messages/server-tools";

vi.mock("../src/services/copilot", async (importActual) => {
  const actual = await importActual<typeof import("../src/services/copilot")>();
  return {
    ...actual,
    getCopilotToken: vi.fn(),
    createMessages: vi.fn(),
    searchViaResponses: vi.fn(),
  };
});

import { createMessages, searchViaResponses } from "../src/services/copilot";

const mockCreateMessages = createMessages as ReturnType<typeof vi.fn>;
const mockSearch = searchViaResponses as ReturnType<typeof vi.fn>;

function makeUpstreamResponse(content: unknown[], stopReason = "end_turn") {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4.6",
      content,
      stop_reason: stopReason,
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

beforeEach(() => {
  mockCreateMessages.mockReset();
  mockSearch.mockReset();
});

// ---------------------------------------------------------------------------
// hasWebSearchTool
// ---------------------------------------------------------------------------

describe("hasWebSearchTool", () => {
  it("returns false for undefined/empty tools", () => {
    expect(hasWebSearchTool(undefined)).toBe(false);
    expect(hasWebSearchTool([])).toBe(false);
  });

  it("returns true when web_search is present", () => {
    expect(
      hasWebSearchTool([
        { type: "web_search_20250305", name: "web_search" },
        { type: "function", name: "other" },
      ])
    ).toBe(true);
  });

  it("returns false when only non-web_search tools", () => {
    expect(hasWebSearchTool([{ type: "function", name: "get_weather" }])).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------------------
// withWebSearch
// ---------------------------------------------------------------------------

describe("withWebSearch", () => {
  it("returns response directly when model does not call web_search", async () => {
    mockCreateMessages.mockResolvedValue(
      makeUpstreamResponse([{ type: "text", text: "Hello!" }])
    );

    const result = await withWebSearch(
      "tok",
      {
        model: "claude-sonnet-4.6",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        tools: [
          { type: "web_search_20250305", name: "web_search" },
          { type: "function", name: "f1", input_schema: {} },
        ],
      },
      undefined
    );

    expect(result.content).toEqual([{ type: "text", text: "Hello!" }]);
    expect(mockCreateMessages).toHaveBeenCalledTimes(1);
    expect(mockSearch).not.toHaveBeenCalled();

    const sent = JSON.parse(mockCreateMessages.mock.calls[0][1]);
    expect(sent.stream).toBe(false);
    expect(sent.tools).toHaveLength(2);
    expect(sent.tools[0].name).toBe("web_search");
    expect(sent.tools[0].input_schema).toBeDefined();
    expect(sent.tools[1]).toEqual({
      type: "function",
      name: "f1",
      input_schema: {},
    });
  });

  it("intercepts web_search tool_use, searches, and loops", async () => {
    mockCreateMessages
      .mockResolvedValueOnce(
        makeUpstreamResponse(
          [
            {
              type: "tool_use",
              id: "toolu_abc123",
              name: "web_search",
              input: { query: "latest AI news" },
            },
          ],
          "tool_use"
        )
      )
      .mockResolvedValueOnce(
        makeUpstreamResponse([
          { type: "text", text: "Here are the results..." },
        ])
      );

    mockSearch.mockResolvedValue([
      { url: "https://example.com", title: "AI News", snippet: "..." },
    ]);

    const result = await withWebSearch(
      "tok",
      {
        model: "claude-sonnet-4.6",
        max_tokens: 1024,
        messages: [{ role: "user", content: "search for AI news" }],
      },
      undefined
    );

    expect(result.content).toEqual([
      { type: "text", text: "Here are the results..." },
    ]);
    expect(mockCreateMessages).toHaveBeenCalledTimes(2);
    expect(mockSearch).toHaveBeenCalledWith("tok", "latest AI news");

    const secondCall = JSON.parse(mockCreateMessages.mock.calls[1][1]);
    expect(secondCall.messages).toHaveLength(3);
    expect(secondCall.messages[1].role).toBe("assistant");
    expect(secondCall.messages[1].content[0].type).toBe("text");
    expect(secondCall.messages[2].role).toBe("user");
    expect(typeof secondCall.messages[2].content).toBe("string");
  });

  it("converts web_search to function tool for upstream", async () => {
    mockCreateMessages.mockResolvedValue(
      makeUpstreamResponse([{ type: "text", text: "ok" }])
    );

    await withWebSearch(
      "tok",
      {
        model: "claude-sonnet-4.6",
        max_tokens: 1024,
        messages: [{ role: "user", content: "hi" }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      },
      undefined
    );

    const sent = JSON.parse(mockCreateMessages.mock.calls[0][1]);
    expect(sent.tools).toHaveLength(1);
    expect(sent.tools[0].name).toBe("web_search");
    expect(sent.tools[0].input_schema).toBeDefined();
    expect(sent.tools[0].type).toBeUndefined();
  });

  it("stops after max iterations", async () => {
    const toolUseBody = JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4.6",
      content: [
        {
          type: "tool_use",
          id: "toolu_abc123",
          name: "web_search",
          input: { query: "test" },
        },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    mockCreateMessages.mockImplementation(
      () =>
        new Response(toolUseBody, {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
    );
    mockSearch.mockResolvedValue([]);

    await withWebSearch(
      "tok",
      {
        model: "claude-sonnet-4.6",
        max_tokens: 1024,
        messages: [{ role: "user", content: "search" }],
      },
      undefined
    );

    // 1 loop iteration + 1 final call = 2
    expect(mockCreateMessages).toHaveBeenCalledTimes(2);
  });

  it("throws on upstream error", async () => {
    mockCreateMessages.mockResolvedValue(
      new Response("bad request", { status: 400 })
    );

    await expect(
      withWebSearch(
        "tok",
        {
          model: "claude-sonnet-4.6",
          max_tokens: 1024,
          messages: [{ role: "user", content: "hi" }],
        },
        undefined
      )
    ).rejects.toThrow("Upstream error 400");
  });
});
