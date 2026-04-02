/**
 * Anthropic Messages API types and translation functions.
 *
 * Converts between Anthropic Messages format and OpenAI Chat Completions format.
 */

// ============================================================================
// Anthropic Types
// ============================================================================

export interface AnthropicMessagesPayload {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string | AnthropicTextBlock[];
  stop_sequences?: string[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
}

export interface AnthropicTextBlock {
  type: "text";
  text: string;
}

export interface AnthropicImageBlock {
  type: "image";
  source: {
    type: "base64";
    media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
    data: string;
  };
}

export interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export type AnthropicUserContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolResultBlock;

export type AnthropicAssistantContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock;

export interface AnthropicUserMessage {
  role: "user";
  content: string | AnthropicUserContentBlock[];
}

export interface AnthropicAssistantMessage {
  role: "assistant";
  content: string | AnthropicAssistantContentBlock[];
}

export type AnthropicMessage = AnthropicUserMessage | AnthropicAssistantMessage;

export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicToolChoice {
  type: "auto" | "any" | "tool" | "none";
  name?: string;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: AnthropicAssistantContentBlock[];
  model: string;
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use" | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Anthropic Stream Events
export interface AnthropicMessageStartEvent {
  type: "message_start";
  message: Omit<
    AnthropicResponse,
    "content" | "stop_reason" | "stop_sequence"
  > & {
    content: [];
    stop_reason: null;
    stop_sequence: null;
  };
}

export interface AnthropicContentBlockStartEvent {
  type: "content_block_start";
  index: number;
  content_block:
    | { type: "text"; text: string }
    | {
        type: "tool_use";
        id: string;
        name: string;
        input: Record<string, unknown>;
      };
}

export interface AnthropicContentBlockDeltaEvent {
  type: "content_block_delta";
  index: number;
  delta:
    | { type: "text_delta"; text: string }
    | { type: "input_json_delta"; partial_json: string };
}

export interface AnthropicContentBlockStopEvent {
  type: "content_block_stop";
  index: number;
}

export interface AnthropicMessageDeltaEvent {
  type: "message_delta";
  delta: {
    stop_reason?: AnthropicResponse["stop_reason"];
    stop_sequence?: string | null;
  };
  usage?: {
    output_tokens: number;
  };
}

export interface AnthropicMessageStopEvent {
  type: "message_stop";
}

export type AnthropicStreamEvent =
  | AnthropicMessageStartEvent
  | AnthropicContentBlockStartEvent
  | AnthropicContentBlockDeltaEvent
  | AnthropicContentBlockStopEvent
  | AnthropicMessageDeltaEvent
  | AnthropicMessageStopEvent;

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
// Translation: Anthropic → OpenAI
// ============================================================================

export function translateModelName(model: string): string {
  // Claude Code sends versioned model names, normalize them
  if (model.startsWith("claude-sonnet-4-")) {
    return "claude-sonnet-4";
  }
  if (
    model.startsWith("claude-opus-4-") ||
    model.startsWith("claude-opus-4.5")
  ) {
    return "claude-opus-4";
  }
  return model;
}

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
// Translation: OpenAI → Anthropic (Response)
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

  for (const choice of response.choices) {
    if (choice.message.content) {
      content.push({ type: "text", text: choice.message.content });
    }
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        content.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
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

// ============================================================================
// Translation: OpenAI Stream → Anthropic Stream Events
// ============================================================================

export interface StreamState {
  messageStartSent: boolean;
  contentBlockIndex: number;
  contentBlockOpen: boolean;
  toolCalls: Record<
    number,
    {
      id: string;
      name: string;
      anthropicBlockIndex: number;
    }
  >;
}

export function createStreamState(): StreamState {
  return {
    messageStartSent: false,
    contentBlockIndex: 0,
    contentBlockOpen: false,
    toolCalls: {},
  };
}

export function translateChunkToAnthropicEvents(
  chunk: OpenAIChatCompletionChunk,
  state: StreamState
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
        stop_reason: mapStopReason(choice.finish_reason),
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

function isToolBlockOpen(state: StreamState): boolean {
  if (!state.contentBlockOpen) return false;
  return Object.values(state.toolCalls).some(
    (tc) => tc.anthropicBlockIndex === state.contentBlockIndex
  );
}
