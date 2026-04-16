/**
 * POST /v1/chat/completions — OpenAI-compatible chat completions passthrough
 */

import type { Context } from "hono";
import {
  getCopilotToken,
  createChatCompletions,
  TokenExchangeError,
} from "../../services/copilot";
import { extractToken } from "../../lib/utils";

export async function handleChatCompletion(c: Context) {
  const requestId = crypto.randomUUID().slice(0, 8);

  // 1. Extract GitHub token
  const githubToken = extractToken(c.req.header("Authorization"));
  if (!githubToken) {
    console.warn(`[${requestId}] POST /v1/chat/completions — 401 missing auth`);
    return c.json({ error: "Missing or malformed Authorization header" }, 401);
  }

  // 2. Exchange for Copilot token
  let copilotToken: string;
  try {
    copilotToken = await getCopilotToken(githubToken);
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      console.error(`[${requestId}] Token exchange failed: ${err.message}`);
      return c.json(
        { error: "Token exchange failed", detail: err.message },
        err.statusCode as 401 | 403 | 500
      );
    }
    throw err;
  }

  // 3. Forward to Copilot API
  const body = await c.req.text();
  console.log(`[${requestId}] POST /v1/chat/completions`);
  const upstream = await createChatCompletions(copilotToken, body);

  if (!upstream.ok) {
    const errorText = await upstream.text();
    console.error(
      `[${requestId}] Upstream error ${upstream.status}: ${errorText}`
    );
    return c.json(
      { error: "Upstream error", detail: errorText },
      upstream.status as 400 | 401 | 403 | 500 | 502
    );
  }

  // 4. Stream the response back
  const headers = new Headers();
  const ct = upstream.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);

  if (ct?.includes("text/event-stream")) {
    headers.set("Cache-Control", "no-cache");
    headers.set("Connection", "keep-alive");
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
