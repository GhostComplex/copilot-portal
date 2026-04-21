/**
 * POST /v1/embeddings — OpenAI embeddings passthrough
 */

import type { Context } from "hono";
import {
  getCopilotToken,
  createEmbeddings,
  TokenExchangeError,
} from "../../services/copilot";
import { extractToken } from "../../lib/utils";

export async function handleEmbeddings(c: Context) {
  const requestId = crypto.randomUUID().slice(0, 8);

  const githubToken = extractToken(c.req.header("Authorization"));
  if (!githubToken) {
    console.warn(`[${requestId}] POST /v1/embeddings — 401 missing auth`);
    return c.json({ error: "Missing or malformed Authorization header" }, 401);
  }

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

  const body = await c.req.text();
  console.log(`[${requestId}] POST /v1/embeddings`);
  const upstream = await createEmbeddings(copilotToken, body);

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

  const headers = new Headers();
  const ct = upstream.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
