/**
 * Non-streaming translation: Anthropic <-> OpenAI formats.
 */

import type {
  AnthropicMessagesPayload,
  AnthropicTextBlock,
  AnthropicUserMessage,
  AnthropicAssistantMessage,
  AnthropicToolResultBlock,
  AnthropicToolUseBlock,
  AnthropicTool,
  AnthropicResponse,
  AnthropicAssistantContentBlock,
  AnthropicUserContentBlock,
} from "./types/anthropic";
import type {
  OpenAIMessage,
  OpenAIContentPart,
  OpenAITool,
  OpenAIChatCompletionsPayload,
  OpenAIChatCompletionResponse,
} from "./types/openai";
import { mapToAnthropicStopReason } from "./types/openai";

// Re-export for external use
export type { OpenAIChatCompletionResponse };

// ============================================================================
// Anthropic -> OpenAI Translation
// ============================================================================

export function translateToOpenAI(
  payload: AnthropicMessagesPayload
): OpenAIChatCompletionsPayload {
  return {
    model: translateModelName(payload.model),
    messages: translateMessages(payload.messages, payload.system),
    max_tokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    user: payload.metadata?.user_id,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
  };
}

function translateModelName(model: string): string {
  if (model.startsWith("claude-sonnet-4-")) {
    return model.replace(/^claude-sonnet-4-.*/, "claude-sonnet-4");
  } else if (model.startsWith("claude-opus-")) {
    return model.replace(/^claude-opus-4-.*/, "claude-opus-4");
  }
  return model;
}

function translateMessages(
  messages: AnthropicMessagesPayload["messages"],
  system: AnthropicMessagesPayload["system"]
): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (system) {
    const systemText =
      typeof system === "string"
        ? system
        : system.map((block) => block.text).join("\n\n");
    result.push({ role: "system", content: systemText });
  }

  for (const msg of messages) {
    if (msg.role === "user") {
      result.push(...handleUserMessage(msg));
    } else {
      result.push(...handleAssistantMessage(msg));
    }
  }

  return result;
}

function handleUserMessage(message: AnthropicUserMessage): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (typeof message.content === "string") {
    result.push({ role: "user", content: message.content });
    return result;
  }

  const toolResults = message.content.filter(
    (block): block is AnthropicToolResultBlock => block.type === "tool_result"
  );
  const otherBlocks = message.content.filter(
    (block) => block.type !== "tool_result"
  );

  for (const block of toolResults) {
    result.push({
      role: "tool",
      tool_call_id: block.tool_use_id,
      content: block.content,
    });
  }

  if (otherBlocks.length > 0) {
    result.push({
      role: "user",
      content: mapContent(otherBlocks),
    });
  }

  return result;
}

function handleAssistantMessage(
  message: AnthropicAssistantMessage
): OpenAIMessage[] {
  if (typeof message.content === "string") {
    return [{ role: "assistant", content: message.content }];
  }

  // Filter out thinking and redacted_thinking blocks — these are Anthropic-specific
  // and carry signatures that must not be mangled. The upstream OpenAI/Copilot API
  // does not support them, so we drop them entirely.
  const supportedBlocks = message.content.filter(
    (block) => block.type !== "thinking" && block.type !== "redacted_thinking"
  );

  const toolUseBlocks = supportedBlocks.filter(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use"
  );
  const textBlocks = supportedBlocks.filter(
    (block): block is AnthropicTextBlock => block.type === "text"
  );

  const textContent = textBlocks.map((b) => b.text).join("\n\n");

  if (toolUseBlocks.length > 0) {
    return [
      {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolUseBlocks.map((block) => ({
          id: block.id,
          type: "function" as const,
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input),
          },
        })),
      },
    ];
  }

  return [{ role: "assistant", content: textContent || null }];
}

function mapContent(
  content: (AnthropicUserContentBlock | AnthropicAssistantContentBlock)[]
): string | OpenAIContentPart[] | null {
  // Filter out thinking/redacted_thinking blocks
  const supported = content.filter(
    (block) => block.type !== "thinking" && block.type !== "redacted_thinking"
  );
  const hasImage = supported.some((block) => block.type === "image");

  if (!hasImage) {
    return supported
      .filter((block): block is AnthropicTextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n\n");
  }

  const parts: OpenAIContentPart[] = [];
  for (const block of supported) {
    if (block.type === "text") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "image") {
      parts.push({
        type: "image_url",
        image_url: {
          url: `data:${block.source.media_type};base64,${block.source.data}`,
        },
      });
    }
  }
  return parts;
}

function translateTools(tools?: AnthropicTool[]): OpenAITool[] | undefined {
  if (!tools) return undefined;
  return tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function translateToolChoice(
  choice?: AnthropicMessagesPayload["tool_choice"]
): OpenAIChatCompletionsPayload["tool_choice"] {
  if (!choice) return undefined;
  switch (choice.type) {
    case "auto":
      return "auto";
    case "any":
      return "required";
    case "none":
      return "none";
    case "tool":
      return choice.name
        ? { type: "function", function: { name: choice.name } }
        : undefined;
    default:
      return undefined;
  }
}

// ============================================================================
// OpenAI -> Anthropic Translation
// ============================================================================

export function translateToAnthropic(
  response: OpenAIChatCompletionResponse
): AnthropicResponse {
  const allTextBlocks: AnthropicTextBlock[] = [];
  const allToolUseBlocks: AnthropicToolUseBlock[] = [];
  let stopReason = response.choices[0]?.finish_reason ?? null;

  if (!response.choices?.length) {
    return {
      id: response.id,
      type: "message",
      role: "assistant",
      model: response.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
    };
  }

  for (const choice of response.choices) {
    if (choice.message.content) {
      allTextBlocks.push({ type: "text", text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          input = {};
        }
        allToolUseBlocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    if (choice.finish_reason === "tool_calls") {
      stopReason = choice.finish_reason;
    }
  }

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content: [...allTextBlocks, ...allToolUseBlocks],
    stop_reason: mapToAnthropicStopReason(stopReason),
    stop_sequence: null,
    usage: {
      input_tokens:
        (response.usage?.prompt_tokens ?? 0) -
        (response.usage?.prompt_tokens_details?.cached_tokens ?? 0),
      output_tokens: response.usage?.completion_tokens ?? 0,
      ...(response.usage?.prompt_tokens_details?.cached_tokens !==
        undefined && {
        cache_read_input_tokens:
          response.usage.prompt_tokens_details.cached_tokens,
      }),
    },
  };
}
