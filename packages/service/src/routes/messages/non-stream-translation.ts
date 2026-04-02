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
  AnthropicToolChoice,
  AnthropicResponse,
  AnthropicAssistantContentBlock,
} from "./anthropic-types";

// ============================================================================
// OpenAI Types (subset needed for translation)
// ============================================================================

interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
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
  tools?: OpenAITool[];
  tool_choice?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };
}

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
    finish_reason: "stop" | "length" | "tool_calls" | "content_filter" | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
  };
}

// ============================================================================
// Model Name Normalization
// ============================================================================

/**
 * Normalize model names - Claude Code sends versioned names that need mapping.
 */
export function translateModelName(model: string): string {
  // claude-sonnet-4-20250514 -> claude-sonnet-4
  if (model.startsWith("claude-sonnet-4-")) {
    return "claude-sonnet-4";
  }
  // claude-opus-4-20250514 or claude-opus-4.5-xxx -> claude-opus-4
  // Note: Copilot doesn't distinguish 4 vs 4.5, both map to claude-opus-4
  if (
    model.startsWith("claude-opus-4-") ||
    model.startsWith("claude-opus-4.5")
  ) {
    return "claude-opus-4";
  }
  return model;
}

// ============================================================================
// Anthropic -> OpenAI Translation
// ============================================================================

export function translateToOpenAI(
  payload: AnthropicMessagesPayload
): OpenAIChatCompletionsPayload {
  const messages: OpenAIMessage[] = [];

  // Handle system prompt
  if (payload.system) {
    const systemText =
      typeof payload.system === "string"
        ? payload.system
        : payload.system.map((block) => block.text).join("\n\n");
    messages.push({ role: "system", content: systemText });
  }

  // Handle messages
  for (const msg of payload.messages) {
    if (msg.role === "user") {
      messages.push(...translateUserMessage(msg));
    } else {
      messages.push(...translateAssistantMessage(msg));
    }
  }

  return {
    model: translateModelName(payload.model),
    messages,
    max_tokens: payload.max_tokens,
    stop: payload.stop_sequences,
    stream: payload.stream,
    temperature: payload.temperature,
    top_p: payload.top_p,
    tools: translateTools(payload.tools),
    tool_choice: translateToolChoice(payload.tool_choice),
  };
}

function translateUserMessage(msg: AnthropicUserMessage): OpenAIMessage[] {
  const result: OpenAIMessage[] = [];

  if (typeof msg.content === "string") {
    result.push({ role: "user", content: msg.content });
    return result;
  }

  // Separate tool results from other content
  const toolResults = msg.content.filter(
    (block): block is AnthropicToolResultBlock => block.type === "tool_result"
  );
  const otherBlocks = msg.content.filter(
    (block) => block.type !== "tool_result"
  );

  // Tool results become separate tool messages
  for (const block of toolResults) {
    result.push({
      role: "tool",
      tool_call_id: block.tool_use_id,
      content: block.content,
    });
  }

  // Other content becomes user message
  if (otherBlocks.length > 0) {
    const hasImage = otherBlocks.some((block) => block.type === "image");
    if (hasImage) {
      const parts: OpenAIContentPart[] = [];
      for (const block of otherBlocks) {
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
      result.push({ role: "user", content: parts });
    } else {
      const text = otherBlocks
        .filter((block): block is AnthropicTextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n\n");
      result.push({ role: "user", content: text });
    }
  }

  return result;
}

function translateAssistantMessage(
  msg: AnthropicAssistantMessage
): OpenAIMessage[] {
  if (typeof msg.content === "string") {
    return [{ role: "assistant", content: msg.content }];
  }

  const textBlocks = msg.content.filter(
    (block): block is AnthropicTextBlock => block.type === "text"
  );
  const toolUseBlocks = msg.content.filter(
    (block): block is AnthropicToolUseBlock => block.type === "tool_use"
  );

  const textContent = textBlocks.map((b) => b.text).join("\n\n") || null;

  if (toolUseBlocks.length > 0) {
    return [
      {
        role: "assistant",
        content: textContent,
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

  return [{ role: "assistant", content: textContent }];
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
  choice?: AnthropicToolChoice
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

function mapStopReason(
  reason: "stop" | "length" | "tool_calls" | "content_filter" | null
): AnthropicResponse["stop_reason"] {
  if (!reason) return null;
  const map = {
    stop: "end_turn",
    length: "max_tokens",
    tool_calls: "tool_use",
    content_filter: "end_turn",
  } as const;
  return map[reason];
}

export function translateToAnthropic(
  response: OpenAIChatCompletionResponse
): AnthropicResponse {
  const content: AnthropicAssistantContentBlock[] = [];

  // Guard against empty/missing choices
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
      content.push({ type: "text", text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        // Safely parse tool arguments - fall back to empty object on malformed JSON
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          input = {};
        }
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }
  }

  const stopReason = response.choices[0]?.finish_reason ?? null;

  return {
    id: response.id,
    type: "message",
    role: "assistant",
    model: response.model,
    content,
    stop_reason: mapStopReason(stopReason),
    stop_sequence: null,
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0,
    },
  };
}

export { mapStopReason };
