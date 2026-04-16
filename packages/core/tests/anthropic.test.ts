/**
 * Tests for Anthropic translation functions.
 */

import { describe, it, expect } from "vitest";
import {
  translateToOpenAI,
  translateToAnthropic,
} from "../src/routes/messages/non-stream-translation";
import {
  translateChunkToAnthropicEvents,
  createStreamState,
} from "../src/routes/messages/stream-translation";
import type { OpenAIChatCompletionChunk } from "../src/routes/messages/types/openai";
import type {
  AnthropicMessagesPayload,
  AnthropicThinkingBlock,
  AnthropicRedactedThinkingBlock,
} from "../src/routes/messages/types/anthropic";
import type { OpenAIChatCompletionResponse } from "../src/routes/messages/types/openai";

describe("translateToOpenAI", () => {
  it("translates basic message", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = translateToOpenAI(payload);

    expect(result.model).toBe("claude-sonnet-4");
    expect(result.max_tokens).toBe(1024);
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
  });

  it("normalizes claude-sonnet-4 versioned names", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = translateToOpenAI(payload);
    expect(result.model).toBe("claude-sonnet-4");
  });

  it("normalizes claude-opus-4 versioned names", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-opus-4-20250514",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = translateToOpenAI(payload);
    expect(result.model).toBe("claude-opus-4");
  });

  it("handles system prompt as string", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      system: "You are helpful",
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are helpful",
    });
  });

  it("handles system prompt as array of text blocks", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      system: [
        { type: "text", text: "First part" },
        { type: "text", text: "Second part" },
      ],
      messages: [{ role: "user", content: "Hello" }],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "First part\n\nSecond part",
    });
  });

  it("translates tool_result blocks", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: "Result data",
            },
          ],
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: "Result data",
    });
  });

  it("translates image blocks to base64 data URLs", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What's this?" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "abc123",
              },
            },
          ],
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0].content).toEqual([
      { type: "text", text: "What's this?" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
    ]);
  });

  it("translates assistant tool_use blocks", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_abc",
              name: "get_weather",
              input: { location: "NYC" },
            },
          ],
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: {
            name: "get_weather",
            arguments: '{"location":"NYC"}',
          },
        },
      ],
    });
  });

  it("strips thinking blocks with signatures from assistant messages", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "Let me think about this...",
              signature: "abc123sig",
            } satisfies AnthropicThinkingBlock,
            { type: "text", text: "Here is my answer" },
          ],
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "Here is my answer",
    });
  });

  it("strips redacted_thinking blocks from assistant messages", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "redacted_thinking",
              data: "opaque-encrypted-data",
            } satisfies AnthropicRedactedThinkingBlock,
            { type: "text", text: "Result" },
          ],
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "Result",
    });
  });

  it("strips thinking blocks alongside tool_use blocks", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "I should call a tool",
              signature: "sig456",
            } satisfies AnthropicThinkingBlock,
            {
              type: "tool_use",
              id: "call_xyz",
              name: "search",
              input: { q: "test" },
            },
          ],
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_xyz",
          type: "function",
          function: { name: "search", arguments: '{"q":"test"}' },
        },
      ],
    });
  });

  it("translates tools", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
      tools: [
        {
          name: "get_weather",
          description: "Get weather",
          input_schema: { type: "object", properties: {} },
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      },
    ]);
  });

  it("translates tool_choice auto", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
      tool_choice: { type: "auto" },
    };

    expect(translateToOpenAI(payload).tool_choice).toBe("auto");
  });

  it("translates tool_choice any to required", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
      tool_choice: { type: "any" },
    };

    expect(translateToOpenAI(payload).tool_choice).toBe("required");
  });

  it("translates tool_choice tool with name", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      max_tokens: 1024,
      messages: [{ role: "user", content: "Hello" }],
      tool_choice: { type: "tool", name: "get_weather" },
    };

    expect(translateToOpenAI(payload).tool_choice).toEqual({
      type: "function",
      function: { name: "get_weather" },
    });
  });
});

describe("translateToAnthropic", () => {
  it("translates basic response", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "chat-123",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hello there!" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const result = translateToAnthropic(response);

    expect(result.id).toBe("chat-123");
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.model).toBe("claude-sonnet-4");
    expect(result.content).toEqual([{ type: "text", text: "Hello there!" }]);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(5);
  });

  it("maps stop reasons correctly", () => {
    const makeResponse = (
      finish_reason: "stop" | "length" | "tool_calls" | "content_filter"
    ): OpenAIChatCompletionResponse => ({
      id: "chat-123",
      model: "test",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Hi" },
          finish_reason,
        },
      ],
    });

    expect(translateToAnthropic(makeResponse("stop")).stop_reason).toBe(
      "end_turn"
    );
    expect(translateToAnthropic(makeResponse("length")).stop_reason).toBe(
      "max_tokens"
    );
    expect(translateToAnthropic(makeResponse("tool_calls")).stop_reason).toBe(
      "tool_use"
    );
    expect(
      translateToAnthropic(makeResponse("content_filter")).stop_reason
    ).toBe("end_turn");
  });

  it("translates tool calls", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "chat-123",
      model: "test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "get_weather",
                  arguments: '{"location":"NYC"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const result = translateToAnthropic(response);

    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: "call_abc",
        name: "get_weather",
        input: { location: "NYC" },
      },
    ]);
    expect(result.stop_reason).toBe("tool_use");
  });

  it("handles empty choices array gracefully", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "chat-123",
      model: "test",
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    };

    const result = translateToAnthropic(response);

    expect(result.content).toEqual([]);
    expect(result.stop_reason).toBeNull();
    expect(result.usage.input_tokens).toBe(10);
    expect(result.usage.output_tokens).toBe(0);
  });

  it("handles malformed tool call arguments gracefully", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "chat-123",
      model: "test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_abc",
                type: "function",
                function: {
                  name: "test_tool",
                  arguments: "not valid json {{{",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const result = translateToAnthropic(response);

    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: "call_abc",
        name: "test_tool",
        input: {},
      },
    ]);
  });
});

describe("translateChunkToAnthropicEvents", () => {
  it("sends message_start on first chunk", () => {
    const state = createStreamState();
    const chunk: OpenAIChatCompletionChunk = {
      id: "chat-123",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          delta: { role: "assistant" },
          finish_reason: null,
        },
      ],
    };

    const events = translateChunkToAnthropicEvents(chunk, state);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_start");
    expect(state.messageStartSent).toBe(true);
  });

  it("sends content_block_start and delta for text", () => {
    const state = createStreamState();
    state.messageStartSent = true;

    const chunk: OpenAIChatCompletionChunk = {
      id: "chat-123",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          delta: { content: "Hello" },
          finish_reason: null,
        },
      ],
    };

    const events = translateChunkToAnthropicEvents(chunk, state);

    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("content_block_start");
    expect(events[1].type).toBe("content_block_delta");
    expect(state.contentBlockOpen).toBe(true);
  });

  it("handles tool call streaming", () => {
    const state = createStreamState();
    state.messageStartSent = true;

    const chunk: OpenAIChatCompletionChunk = {
      id: "chat-123",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_abc",
                function: { name: "get_weather" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const events = translateChunkToAnthropicEvents(chunk, state);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("content_block_start");
    expect(state.toolCalls[0]).toBeDefined();
  });

  it("sends message_delta and message_stop on finish", () => {
    const state = createStreamState();
    state.messageStartSent = true;
    state.contentBlockOpen = true;

    const chunk: OpenAIChatCompletionChunk = {
      id: "chat-123",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          delta: {},
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const events = translateChunkToAnthropicEvents(chunk, state);

    expect(events.map((e) => e.type)).toEqual([
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("returns empty array for empty choices", () => {
    const state = createStreamState();
    const chunk: OpenAIChatCompletionChunk = {
      id: "chat-123",
      model: "claude-sonnet-4",
      choices: [],
    };

    const events = translateChunkToAnthropicEvents(chunk, state);
    expect(events).toHaveLength(0);
  });
});
