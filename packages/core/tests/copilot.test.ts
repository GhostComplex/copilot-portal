import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getCopilotToken,
  clearTokenCache,
  isTokenValid,
  createChatCompletions,
  createMessages,
  getModels,
  resetVSCodeVersionCache,
  searchViaResponses,
  TokenExchangeError,
  HttpError,
  type GetCopilotTokenResponse,
} from "../src/services/copilot";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("isTokenValid", () => {
  it("returns false for undefined", () => {
    expect(isTokenValid(undefined, Date.now())).toBe(false);
  });

  it("returns true for valid token", () => {
    const cached = { token: "test", expiresAt: Date.now() + 60000 };
    expect(isTokenValid(cached, Date.now())).toBe(true);
  });

  it("returns false for expired token", () => {
    const cached = { token: "test", expiresAt: Date.now() - 1000 };
    expect(isTokenValid(cached, Date.now())).toBe(false);
  });
});

describe("getCopilotToken", () => {
  beforeEach(() => {
    clearTokenCache();
    mockFetch.mockReset();
  });

  it("exchanges GitHub token for Copilot token", async () => {
    const mockResponse: GetCopilotTokenResponse = {
      token: "copilot-jwt-token",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      refresh_in: 1500,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const token = await getCopilotToken("github-token");
    expect(token).toBe("copilot-jwt-token");
  });

  it("throws TokenExchangeError on 401", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    });

    await expect(getCopilotToken("bad-token")).rejects.toThrow(
      TokenExchangeError
    );
  });

  it("caches token for subsequent calls", async () => {
    const mockResponse: GetCopilotTokenResponse = {
      token: "cached-token",
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      refresh_in: 1500,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockResponse,
    });

    const token1 = await getCopilotToken("github-token");
    const token2 = await getCopilotToken("github-token");

    expect(token1).toBe(token2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("createChatCompletions", () => {
  beforeEach(() => {
    resetVSCodeVersionCache();
    mockFetch.mockReset();
  });

  it("forwards request to Copilot API", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ["1.100.0"],
      })
      .mockResolvedValueOnce({
        ok: true,
        body: "stream",
        headers: new Headers({ "Content-Type": "text/event-stream" }),
      });

    const response = await createChatCompletions(
      "copilot-token",
      JSON.stringify({ model: "gpt-4", messages: [] })
    );

    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toBe(
      "https://api.githubcopilot.com/chat/completions"
    );
  });
});

describe("createMessages", () => {
  beforeEach(() => {
    resetVSCodeVersionCache();
    mockFetch.mockReset();
  });

  it("forwards request without anthropic-beta header", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ["1.100.0"] })
      .mockResolvedValueOnce({ ok: true });

    await createMessages("tok", "{}");
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("https://api.githubcopilot.com/v1/messages");
    expect(init.headers["anthropic-beta"]).toBeUndefined();
  });

  it("forwards anthropic-beta header when provided", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ["1.100.0"] })
      .mockResolvedValueOnce({ ok: true });

    await createMessages("tok", "{}", {
      "anthropic-beta": "context-management-2025-06-27",
    });
    const init = mockFetch.mock.calls[1][1];
    expect(init.headers["anthropic-beta"]).toBe(
      "context-management-2025-06-27"
    );
  });
});

describe("getModels", () => {
  beforeEach(() => {
    resetVSCodeVersionCache();
    mockFetch.mockReset();
  });

  it("GETs the models endpoint", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ["1.100.0"] })
      .mockResolvedValueOnce({ ok: true });

    await getModels("tok");
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe("https://api.githubcopilot.com/models");
    expect(init.method).toBe("GET");
  });
});

describe("fetchVSCodeVersion", () => {
  beforeEach(() => {
    resetVSCodeVersionCache();
    mockFetch.mockReset();
  });

  it("falls back when releases fetch fails", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });

    await createChatCompletions("tok", "{}");
    expect(mockFetch.mock.calls[1][1].headers["Editor-Version"]).toBe(
      "vscode/1.110.1"
    );
  });

  it("falls back on invalid payload shape", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true });

    await createChatCompletions("tok", "{}");
    expect(mockFetch.mock.calls[1][1].headers["Editor-Version"]).toBe(
      "vscode/1.110.1"
    );
  });

  it("caches the resolved version across calls", async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ["1.101.0"] })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });

    await createChatCompletions("tok", "{}");
    await createChatCompletions("tok", "{}");
    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(mockFetch.mock.calls[2][1].headers["Editor-Version"]).toBe(
      "vscode/1.101.0"
    );
  });
});

describe("getCopilotToken additional error paths", () => {
  beforeEach(() => {
    clearTokenCache();
    mockFetch.mockReset();
  });

  it("maps non-auth errors to 500", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => "Bad Gateway",
    });

    try {
      await getCopilotToken("tok");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TokenExchangeError);
      expect((e as TokenExchangeError).statusCode).toBe(500);
    }
  });

  it("propagates 403 status", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    });

    try {
      await getCopilotToken("tok");
      throw new Error("expected throw");
    } catch (e) {
      expect((e as TokenExchangeError).statusCode).toBe(403);
    }
  });
});

describe("Error classes", () => {
  it("HttpError has statusCode", () => {
    const error = new HttpError("Server error", 500);
    expect(error.statusCode).toBe(500);
    expect(error.name).toBe("HttpError");
  });

  it("TokenExchangeError extends HttpError", () => {
    const error = new TokenExchangeError("Token exchange failed", 401);
    expect(error.statusCode).toBe(401);
    expect(error.name).toBe("TokenExchangeError");
    expect(error).toBeInstanceOf(HttpError);
  });
});

describe("searchViaResponses", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    resetVSCodeVersionCache();
    // First call fetches vscode version
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(["1.100.0"]), { status: 200 })
    );
  });

  it("extracts text from message output items", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: [
            { type: "reasoning", id: "r1", summary: [] },
            {
              type: "web_search_call",
              id: "ws1",
              action: {},
              status: "completed",
            },
            {
              type: "message",
              id: "m1",
              role: "assistant",
              content: [
                { type: "output_text", text: "Search result text here" },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const results = await searchViaResponses("tok", "test query");
    expect(results).toHaveLength(1);
    expect(results[0].snippet).toBe("Search result text here");
    expect(results[0].title).toBe("Web Search Result");
  });

  it("returns empty array on non-ok response", async () => {
    mockFetch.mockResolvedValueOnce(new Response("error", { status: 500 }));
    const results = await searchViaResponses("tok", "test");
    expect(results).toEqual([]);
  });

  it("returns empty array when output is not an array", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ output: null }), { status: 200 })
    );
    const results = await searchViaResponses("tok", "test");
    expect(results).toEqual([]);
  });

  it("returns empty array on fetch error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));
    const results = await searchViaResponses("tok", "test");
    expect(results).toEqual([]);
  });

  it("skips message items with non-array content", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          output: [{ type: "message", id: "m1", content: "not an array" }],
        }),
        { status: 200 }
      )
    );
    const results = await searchViaResponses("tok", "test");
    expect(results).toEqual([]);
  });
});
