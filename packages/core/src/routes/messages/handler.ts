/**
 * POST /v1/messages — Anthropic Messages API passthrough
 */

import type { Context } from "hono";
import {
  getCopilotToken,
  createMessages,
  filterAnthropicBeta,
  TokenExchangeError,
} from "../../services/copilot";
import { extractToken } from "../../lib/utils";
import { rewriteRequestBody } from "./rewrite";

export async function handleMessages(c: Context) {
  const requestId = crypto.randomUUID().slice(0, 8);

  // 1. Extract GitHub token
  const githubToken = extractToken(c.req.header("Authorization"));
  if (!githubToken) {
    console.warn(`[${requestId}] POST /v1/messages — 401 missing auth`);
    return c.json(
      {
        type: "error",
        error: {
          type: "authentication_error",
          message: "Missing or malformed Authorization header",
        },
      },
      401
    );
  }

  // 2. Exchange for Copilot token
  let copilotToken: string;
  try {
    copilotToken = await getCopilotToken(githubToken);
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      console.error(`[${requestId}] Token exchange failed: ${err.message}`);
      return c.json(
        {
          type: "error",
          error: {
            type: "authentication_error",
            message: err.message,
          },
        },
        err.statusCode as 401 | 403 | 500
      );
    }
    throw err;
  }

  // 3. Rewrite request body (inject defaults, model-specific shape fixes,
  //    map context-1m/fast-mode beta → model name suffix).
  const rawBeta = c.req.header("anthropic-beta");
  const { body, model } = rewriteRequestBody(await c.req.text(), rawBeta);

  console.log(`[${requestId}] POST /v1/messages`);
  const anthropicBeta = filterAnthropicBeta(rawBeta, model);
  const upstream = await createMessages(copilotToken, body, anthropicBeta);

  if (!upstream.ok) {
    const errorText = await upstream.text();
    console.error(
      `[${requestId}] Upstream error ${upstream.status}: ${errorText}`
    );
    return c.json(
      {
        type: "error",
        error: { type: "api_error", message: errorText },
      },
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
