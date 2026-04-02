/**
 * POST /v1/messages — Anthropic Messages API handler
 *
 * Matches copilot-api's routes/messages/handler.ts
 */

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import {
  getCopilotToken,
  createChatCompletions,
  clearTokenCache,
  isTokenValid,
  TokenExchangeError,
} from "../../services/copilot";
import { extractToken } from "../../lib/utils";
import { transformSSE } from "../../lib/sse";
import type { AnthropicMessagesPayload } from "./anthropic-types";
import {
  translateToOpenAI,
  translateToAnthropic,
  type OpenAIChatCompletionResponse,
} from "./non-stream-translation";
import {
  createStreamState,
  translateChunkToAnthropicEvents,
  type OpenAIChatCompletionChunk,
} from "./stream-translation";

export async function handleMessages(c: Context) {
  // 1. Extract GitHub token
  const githubToken = extractToken(c.req.header("Authorization"));
  if (!githubToken) {
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
  const upstream = await createChatCompletions(
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
    return c.json(
      {
        type: "error",
        error: { type: "api_error", message: "No upstream body" },
      },
      502
    );
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

// Re-export for testing
export { clearTokenCache, isTokenValid };
