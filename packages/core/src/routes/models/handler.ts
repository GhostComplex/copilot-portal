/**
 * GET /v1/models — List available models from Copilot API
 */

import type { Context } from "hono";
import { getModels } from "../../services/copilot";
import { withCopilotToken, openaiErrorShape } from "../../lib/proxy";

export async function handleModels(c: Context) {
  const result = await withCopilotToken(c, "GET /v1/models", openaiErrorShape);
  if (!result.ok) return result.response;

  const upstream = await getModels(result.copilotToken);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
