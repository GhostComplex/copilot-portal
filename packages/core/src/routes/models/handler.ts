/**
 * GET /v1/models — List available models from Copilot API
 */

import type { Context } from "hono";
import {
  getCopilotToken,
  getModels,
  TokenExchangeError,
} from "../../services/copilot";
import { extractToken } from "../../lib/utils";

export async function handleModels(c: Context) {
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
        err.statusCode as 401 | 403 | 500
      );
    }
    throw err;
  }

  // 3. Fetch models from Copilot API
  const upstream = await getModels(copilotToken);

  // 4. Return response
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
