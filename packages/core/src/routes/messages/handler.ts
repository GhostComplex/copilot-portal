/**
 * POST /v1/messages — Anthropic Messages API passthrough
 *
 * When a web_search tool is detected, the handler intercepts it and
 * executes searches via the Copilot /responses API, then injects results
 * back into the conversation. Otherwise, requests pass through unchanged.
 */

import { createMessages } from "../../services/copilot";
import {
  pipeline,
  anthropicErrorShape,
  type PipelineContext,
} from "../../lib/proxy";
import { anthropicToSSE } from "../../lib/sse";
import { rewriteRequest } from "./rewrite";
import { hasWebSearchTool, withWebSearch } from "./server-tools";

function detectWebSearch(parsed: Record<string, unknown> | null): boolean {
  return hasWebSearchTool(
    parsed?.tools as Record<string, unknown>[] | undefined
  );
}

async function interceptWebSearch(ctx: PipelineContext): Promise<Response> {
  const wantStream = ctx.parsed?.stream === true;
  console.log(`[${ctx.requestId}] POST /v1/messages (web-search interception)`);

  try {
    const response = await withWebSearch(
      ctx.copilotToken,
      ctx.parsed!,
      ctx.headers
    );
    return wantStream ? streamResponse(response) : ctx.c.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[${ctx.requestId}] Web-search interception failed: ${message}`
    );
    return ctx.c.json(anthropicErrorShape.upstream(message), 502);
  }
}

function streamResponse(response: Record<string, unknown>) {
  return new Response(anthropicToSSE(response), {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export const handleMessages = pipeline("POST /v1/messages")
  .errorShape(anthropicErrorShape)
  .translate(rewriteRequest)
  .intercept(detectWebSearch, interceptWebSearch)
  .send(createMessages);
