import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isTokenValid,
  buildCopilotHeaders,
  buildGitHubHeaders,
  withRetry,
  getCopilotToken,
  forwardChatCompletions,
  TokenExchangeError,
  HttpError,
  clearTokenCache,
  resetVSCodeVersionCache,
  type CachedToken,
} from "../src/copilot";

describe("isTokenValid", () => {
  const REFRESH_MARGIN_SEC = 5 * 60; // must match copilot.ts

  it("returns false for undefined cached token", () => {
    expect(isTokenValid(undefined, 1000)).toBe(false);
  });

  it("returns false when token is expired", () => {
    const cached: CachedToken = { token: "abc", expiresAt: 1000 };
    expect(isTokenValid(cached, 1000)).toBe(false);
  });

  it("returns false when token expires within refresh margin", () => {
    const now = 1000;
    const cached: CachedToken = { token: "abc", expiresAt: now + REFRESH_MARGIN_SEC - 1 };
    expect(isTokenValid(cached, now)).toBe(false);
  });

  it("returns true when token is valid and outside refresh margin", () => {
    const now = 1000;
    const cached: CachedToken = { token: "abc", expiresAt: now + REFRESH_MARGIN_SEC + 100 };
    expect(isTokenValid(cached, now)).toBe(true);
  });

  it("returns true when token has plenty of time left", () => {
    const cached: CachedToken = { token: "abc", expiresAt: 9999999999 };
    expect(isTokenValid(cached, 1000)).toBe(true);
  });
});

describe("buildCopilotHeaders", () => {
  beforeEach(() => {
    resetVSCodeVersionCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(["1.90.0"]),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes Authorization header with Bearer token", async () => {
    const headers = await buildCopilotHeaders("test-token");
    expect(headers.Authorization).toBe("Bearer test-token");
  });

  it("includes Content-Type header", async () => {
    const headers = await buildCopilotHeaders("test-token");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("includes User-Agent header", async () => {
    const headers = await buildCopilotHeaders("test-token");
    expect(headers["User-Agent"]).toMatch(/^GitHubCopilotChat\//);
  });

  it("includes Editor-Version header", async () => {
    const headers = await buildCopilotHeaders("test-token");
    expect(headers["Editor-Version"]).toMatch(/^vscode\//);
  });

  it("includes Editor-Plugin-Version header", async () => {
    const headers = await buildCopilotHeaders("test-token");
    expect(headers["Editor-Plugin-Version"]).toMatch(/^copilot-chat\//);
  });

  it("includes Copilot-Integration-Id header", async () => {
    const headers = await buildCopilotHeaders("test-token");
    expect(headers["Copilot-Integration-Id"]).toBe("vscode-chat");
  });
});

describe("buildGitHubHeaders", () => {
  beforeEach(() => {
    resetVSCodeVersionCache();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(["1.90.0"]),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes Accept header", async () => {
    const headers = await buildGitHubHeaders();
    expect(headers.Accept).toBe("application/json");
  });

  it("includes User-Agent header", async () => {
    const headers = await buildGitHubHeaders();
    expect(headers["User-Agent"]).toMatch(/^GitHubCopilotChat\//);
  });

  it("does NOT include Authorization header", async () => {
    const headers = await buildGitHubHeaders();
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("withRetry", () => {
  it("returns immediately on success", async () => {
    const fn = vi.fn().mockResolvedValue("success");
    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient failure and eventually succeeds", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network error"))
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue("success");

    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("throws after exhausting retries", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("Persistent error"));

    await expect(withRetry(fn, 2, 10)).rejects.toThrow("Persistent error");
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does not retry on 4xx client errors (HttpError)", async () => {
    const fn = vi.fn().mockRejectedValue(new HttpError("Unauthorized", 401));

    await expect(withRetry(fn, 3, 10)).rejects.toThrow("Unauthorized");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry on 403 errors (TokenExchangeError)", async () => {
    const fn = vi.fn().mockRejectedValue(new TokenExchangeError("Forbidden", 403));

    await expect(withRetry(fn, 3, 10)).rejects.toThrow("Forbidden");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx server errors (HttpError)", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new HttpError("Server error", 500))
      .mockResolvedValue("success");

    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("retries on generic errors without statusCode", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network timeout"))
      .mockResolvedValue("success");

    const result = await withRetry(fn, 3, 10);
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe("getCopilotToken", () => {
  beforeEach(() => {
    clearTokenCache();
    resetVSCodeVersionCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges GitHub token for Copilot token", async () => {
    const fetchMock = vi
      .fn()
      // VS Code version fetch
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["1.90.0"]),
      })
      // Token exchange
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "copilot-jwt-token",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
        text: () => Promise.resolve(""),
      });

    vi.stubGlobal("fetch", fetchMock);

    const token = await getCopilotToken("ghp_test123");
    expect(token).toBe("copilot-jwt-token");
  });

  it("throws TokenExchangeError on failed exchange", async () => {
    const fetchMock = vi
      .fn()
      // VS Code version
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["1.90.0"]),
      })
      // Failed token exchange
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

    vi.stubGlobal("fetch", fetchMock);

    await expect(getCopilotToken("invalid-token")).rejects.toThrow(TokenExchangeError);
  });

  it("returns cached token on subsequent calls", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["1.90.0"]),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            token: "cached-token",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          }),
      });

    vi.stubGlobal("fetch", fetchMock);

    const token1 = await getCopilotToken("ghp_cached");
    const token2 = await getCopilotToken("ghp_cached");

    expect(token1).toBe("cached-token");
    expect(token2).toBe("cached-token");
    // Should only call fetch twice (VS Code version + first token exchange)
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("forwardChatCompletions", () => {
  beforeEach(() => {
    resetVSCodeVersionCache();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("forwards request to Copilot API", async () => {
    const fetchMock = vi
      .fn()
      // VS Code version
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["1.90.0"]),
      })
      // Copilot API response
      .mockResolvedValueOnce(
        new Response('{"choices":[]}', {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const response = await forwardChatCompletions("copilot-token", '{"messages":[]}');
    expect(response.status).toBe(200);

    // Verify second call was to Copilot API
    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall[0]).toBe("https://api.githubcopilot.com/chat/completions");
    expect(secondCall[1].method).toBe("POST");
  });

  it("includes correct headers", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(["1.90.0"]),
      })
      .mockResolvedValueOnce(new Response("{}"));

    vi.stubGlobal("fetch", fetchMock);

    await forwardChatCompletions("my-token", "{}");

    const [, options] = fetchMock.mock.calls[1];
    expect(options.headers.Authorization).toBe("Bearer my-token");
    expect(options.headers["Content-Type"]).toBe("application/json");
    expect(options.headers["Copilot-Integration-Id"]).toBe("vscode-chat");
  });
});

describe("TokenExchangeError", () => {
  it("has correct name and properties", () => {
    const error = new TokenExchangeError("Test error", 401);
    expect(error.name).toBe("TokenExchangeError");
    expect(error.message).toBe("Test error");
    expect(error.statusCode).toBe(401);
    expect(error instanceof Error).toBe(true);
  });
});
