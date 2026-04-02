/**
 * Route handlers.
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getCopilotToken,
  forwardChatCompletions,
  TokenExchangeError,
} from "./copilot";
import { extractToken } from "./utils";
import { transformSSE } from "./sse";
import {
  translateToOpenAI,
  translateToAnthropic,
  translateChunkToAnthropicEvents,
  createStreamState,
  type AnthropicMessagesPayload,
  type OpenAIChatCompletionResponse,
  type OpenAIChatCompletionChunk,
} from "./anthropic";

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
        err.statusCode as 401 | 403 | 500
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

/**
 * POST /v1/messages — Anthropic Messages API compatible endpoint
 */
export async function messages(c: Context) {
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

  // 3. Parse Anthropic request and translate to OpenAI format
  let anthropicPayload: AnthropicMessagesPayload;
  try {
    anthropicPayload = await c.req.json<AnthropicMessagesPayload>();
  } catch {
    return c.json(
      {
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Invalid JSON in request body",
        },
      },
      400
    );
  }
  const openaiPayload = translateToOpenAI(anthropicPayload);

  // 4. Forward to Copilot API
  const upstream = await forwardChatCompletions(
    copilotToken,
    JSON.stringify(openaiPayload)
  );

  // 5. Handle upstream errors
  if (!upstream.ok) {
    const errorText = await upstream.text();
    return c.json(
      {
        type: "error",
        error: { type: "api_error", message: errorText },
      },
      upstream.status as 400 | 401 | 403 | 500 | 502
    );
  }

  // 6. Handle non-streaming response
  if (!anthropicPayload.stream) {
    const openaiResponse =
      (await upstream.json()) as OpenAIChatCompletionResponse;
    const anthropicResponse = translateToAnthropic(openaiResponse);
    return c.json(anthropicResponse);
  }

  // 7. Handle streaming response
  if (!upstream.body) {
    return c.json({ error: "No upstream body" }, 502);
  }

  const state = createStreamState();
  const body = upstream.body;

  return streamSSE(c, async (stream) => {
    const events = transformSSE(body, (_event, data) => {
      const trimmed = data.trim();
      if (trimmed === "[DONE]" || !trimmed) return null;

      try {
        const chunk = JSON.parse(trimmed) as OpenAIChatCompletionChunk;
        return translateChunkToAnthropicEvents(chunk, state).map((e) => ({
          event: e.type,
          data: JSON.stringify(e),
        }));
      } catch {
        return null;
      }
    });

    for await (const e of events) {
      await stream.writeSSE({ event: e.event, data: e.data });
    }
  });
}

/**
 * GET /v1/models — List available models
 */
export function models(c: Context) {
  // Models available through GitHub Copilot
  const modelList = [
    { id: "claude-opus-4", object: "model", owned_by: "anthropic" },
    { id: "claude-sonnet-4", object: "model", owned_by: "anthropic" },
    { id: "gpt-4o", object: "model", owned_by: "openai" },
    { id: "gpt-4o-mini", object: "model", owned_by: "openai" },
    { id: "o1", object: "model", owned_by: "openai" },
    { id: "o3-mini", object: "model", owned_by: "openai" },
  ];

  return c.json({
    object: "list",
    data: modelList,
  });
}
