/**
 * Route handlers.
 */

import type { Context } from "hono";
import { getCopilotToken, forwardChatCompletions, TokenExchangeError } from "./copilot";
import { extractToken } from "./utils";

/**
 * GET /health — health check
 */
export function health(c: Context) {
  return c.json({ status: "ok" });
}

/**
 * POST /v1/chat/completions — OpenAI-compatible chat completions passthrough
 */
export async function chatCompletions(c: Context) {
  // 1. Extract GitHub token
  const githubToken = extractToken(c.req.header("Authorization"));
  if (!githubToken) {
    return c.json({ error: "Missing or malformed Authorization header" }, 401);
  }

  // 2. Exchange for Copilot token
  let copilotToken: string;
  try {
    copilotToken = await getCopilotToken(githubToken);
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      return c.json(
        { error: "Token exchange failed", detail: err.message },
        err.statusCode as 401 | 403 | 500,
      );
    }
    throw err;
  }

  // 3. Forward to Copilot API
  const body = await c.req.text();
  const upstream = await forwardChatCompletions(copilotToken, body);

  // 4. Stream the response back
  const headers = new Headers();
  const ct = upstream.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);

  // Streaming: if the upstream is SSE, pipe it through
  if (ct?.includes("text/event-stream")) {
    headers.set("Cache-Control", "no-cache");
    headers.set("Connection", "keep-alive");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

/**
 * Fallback 404 handler
 */
export function notFound(c: Context) {
  return c.json({ error: "Not found" }, 404);
}
