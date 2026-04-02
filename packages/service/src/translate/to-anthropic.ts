/**
 * Streaming translation: OpenAI chunks -> Anthropic SSE events.
 */

import type {
  AnthropicStreamEvent,
  AnthropicStreamState,
  AnthropicResponse,
} from "../types/anthropic";
import { mapStopReason } from "./to-openai";

// ============================================================================
// OpenAI Chunk Types
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
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ============================================================================
// Stream State Factory
// ============================================================================

export function createStreamState(): AnthropicStreamState {
  return {
    messageStartSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    toolCalls: {},
  };
}

// ============================================================================
// Chunk Translation
// ============================================================================

export function translateChunkToAnthropicEvents(
  chunk: OpenAIChatCompletionChunk,
  state: AnthropicStreamState
): AnthropicStreamEvent[] {
  const events: AnthropicStreamEvent[] = [];

  if (chunk.choices.length === 0) return events;

  const choice = chunk.choices[0];
  const delta = choice.delta;

  // Send message_start on first chunk
  if (!state.messageStartSent) {
    events.push({
      type: "message_start",
      message: {
        id: chunk.id,
        type: "message",
        role: "assistant",
        content: [],
        model: chunk.model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: chunk.usage?.prompt_tokens ?? 0,
          output_tokens: 0,
        },
      },
    });
    state.messageStartSent = true;
  }

  // Handle text content
  if (delta.content) {
    // Close any open tool block first
    if (state.contentBlockOpen && isToolBlockOpen(state)) {
      events.push({
        type: "content_block_stop",
        index: state.contentBlockIndex,
      });
      state.contentBlockIndex++;
      state.contentBlockOpen = false;
    }

    // Open text block if needed
    if (!state.contentBlockOpen) {
      events.push({
        type: "content_block_start",
        index: state.contentBlockIndex,
        content_block: { type: "text", text: "" },
      });
      state.contentBlockOpen = true;
    }

    events.push({
      type: "content_block_delta",
      index: state.contentBlockIndex,
      delta: { type: "text_delta", text: delta.content },
    });
  }

  // Handle tool calls
  if (delta.tool_calls) {
    for (const tc of delta.tool_calls) {
      if (tc.id && tc.function?.name) {
        // New tool call starting
        if (state.contentBlockOpen) {
          events.push({
            type: "content_block_stop",
            index: state.contentBlockIndex,
          });
          state.contentBlockIndex++;
          state.contentBlockOpen = false;
        }

        const anthropicBlockIndex = state.contentBlockIndex;
        state.toolCalls[tc.index] = {
          id: tc.id,
          name: tc.function.name,
          anthropicBlockIndex,
        };

        events.push({
          type: "content_block_start",
          index: anthropicBlockIndex,
          content_block: {
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: {},
          },
        });
        state.contentBlockOpen = true;
      }

      if (tc.function?.arguments) {
        const toolCallInfo = state.toolCalls[tc.index];
        if (toolCallInfo) {
          events.push({
            type: "content_block_delta",
            index: toolCallInfo.anthropicBlockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: tc.function.arguments,
            },
          });
        }
      }
    }
  }

  // Handle finish
  if (choice.finish_reason) {
    if (state.contentBlockOpen) {
      events.push({
        type: "content_block_stop",
        index: state.contentBlockIndex,
      });
      state.contentBlockOpen = false;
    }

    events.push({
      type: "message_delta",
      delta: {
        stop_reason: mapStopReason(
          choice.finish_reason
        ) as AnthropicResponse["stop_reason"],
        stop_sequence: null,
      },
      usage: {
        output_tokens: chunk.usage?.completion_tokens ?? 0,
      },
    });

    events.push({ type: "message_stop" });
  }

  return events;
}

function isToolBlockOpen(state: AnthropicStreamState): boolean {
  if (!state.contentBlockOpen) return false;
  return Object.values(state.toolCalls).some(
    (tc) => tc.anthropicBlockIndex === state.contentBlockIndex
  );
}
