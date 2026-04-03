/**
 * OpenAI API Types (subset needed for translation)
 */

// ============================================================================
// Request Types
// ============================================================================

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIChatCompletionsPayload {
  model: string;
  messages: OpenAIMessage[];
  max_tokens?: number;
  stop?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  user?: string;
  tools?: OpenAITool[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
}

// ============================================================================
// Response Types (non-streaming)
// ============================================================================

export interface OpenAIChatCompletionResponse {
  id: string;
  model: string;
  choices: {
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: OpenAIFinishReason | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: {
      cached_tokens: number;
    };
  };
}

// ============================================================================
// Response Types (streaming)
// ============================================================================

export interface OpenAIChatCompletionChunk {
  id: string;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: "assistant";
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: OpenAIFinishReason | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    prompt_tokens_details?: {
      cached_tokens: number;
    };
  };
}

// ============================================================================
// Common Types
// ============================================================================

export type OpenAIFinishReason =
  | "stop"
  | "length"
  | "tool_calls"
  | "content_filter";

// ============================================================================
// Mapping
// ============================================================================

import type { AnthropicResponse } from "./anthropic";

const STOP_REASON_MAP = {
  stop: "end_turn",
  length: "max_tokens",
  tool_calls: "tool_use",
  content_filter: "end_turn",
} as const;

export function mapToAnthropicStopReason(
  finishReason: OpenAIFinishReason | null
): AnthropicResponse["stop_reason"] {
  if (finishReason === null) return null;
  return STOP_REASON_MAP[finishReason];
}
