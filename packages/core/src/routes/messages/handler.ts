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
import type { AnthropicMessagesPayload } from "./types/anthropic";
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

/**
 * Map OpenAI error codes to Anthropic error types.
 */
const OPENAI_CODE_TO_ANTHROPIC_TYPE: Record<string, string> = {
  model_max_prompt_tokens_exceeded: "invalid_request_error",
  context_length_exceeded: "invalid_request_error",
  invalid_api_key: "authentication_error",
  insufficient_quota: "rate_limit_error",
  rate_limit_exceeded: "rate_limit_error",
  server_error: "api_error",
};

/**
 * Parse upstream OpenAI-format error response into an Anthropic-compatible
 * error type and human-readable message.
 */
function parseUpstreamError(
  rawText: string,
  statusCode: number
): { errorType: string; message: string } {
  try {
    const parsed = JSON.parse(rawText);
    if (parsed?.error?.message) {
      const code: string | undefined = parsed.error.code;
      const errorType =
        (code && OPENAI_CODE_TO_ANTHROPIC_TYPE[code]) ||
        (statusCode === 401 || statusCode === 403
          ? "authentication_error"
          : statusCode === 429
            ? "rate_limit_error"
            : "api_error");
      return { errorType, message: parsed.error.message };
    }
  } catch {
    // not JSON — fall through
  }
  return { errorType: "api_error", message: rawText };
}

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
    const { errorType, message } = parseUpstreamError(
      errorText,
      upstream.status
    );
    return c.json(
      {
        type: "error",
        error: { type: errorType, message },
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
