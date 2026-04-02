/**
 * Tests for Anthropic translation functions.
 */

import { describe, it, expect } from "vitest";
import {
  translateToOpenAI,
  translateToAnthropic,
  translateChunkToAnthropicEvents,
  createStreamState,
  translateModelName,
  type AnthropicMessagesPayload,
  type OpenAIChatCompletionResponse,
  type OpenAIChatCompletionChunk,
} from "../src/anthropic";

describe("translateModelName", () => {
  it("normalizes claude-sonnet-4 versioned names", () => {
    expect(translateModelName("claude-sonnet-4-20250514")).toBe(
      "claude-sonnet-4"
    );
    expect(translateModelName("claude-sonnet-4-latest")).toBe(
      "claude-sonnet-4"
    );
  });

  it("normalizes claude-opus-4 versioned names", () => {
    expect(translateModelName("claude-opus-4-20250514")).toBe("claude-opus-4");
    expect(translateModelName("claude-opus-4.5")).toBe("claude-opus-4");
  });

  it("passes through other model names", () => {
    expect(translateModelName("gpt-4o")).toBe("gpt-4o");
    expect(translateModelName("o1")).toBe("o1");
  });
});

describe("translateToOpenAI", () => {
  it("translates basic text message", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hello" }],
      max_tokens: 1024,
    };

    const result = translateToOpenAI(payload);

    expect(result.model).toBe("claude-sonnet-4");
    expect(result.max_tokens).toBe(1024);
    expect(result.messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("handles system prompt as string", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      system: "You are a helpful assistant.",
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "You are a helpful assistant.",
    });
    expect(result.messages[1]).toEqual({ role: "user", content: "Hi" });
  });

  it("handles system prompt as array", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      system: [
        { type: "text", text: "First part." },
        { type: "text", text: "Second part." },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0]).toEqual({
      role: "system",
      content: "First part.\n\nSecond part.",
    });
  });

  it("handles tool results", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_123",
              content: "Result here",
            },
            { type: "text", text: "What now?" },
          ],
        },
      ],
      max_tokens: 100,
    };

    const result = translateToOpenAI(payload);

    expect(result.messages).toEqual([
      { role: "tool", tool_call_id: "call_123", content: "Result here" },
      { role: "user", content: "What now?" },
    ]);
  });

  it("handles assistant message with tool_use", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Let me check." },
            {
              type: "tool_use",
              id: "call_456",
              name: "get_weather",
              input: { city: "Tokyo" },
            },
          ],
        },
      ],
      max_tokens: 100,
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0]).toEqual({
      role: "assistant",
      content: "Let me check.",
      tool_calls: [
        {
          id: "call_456",
          type: "function",
          function: {
            name: "get_weather",
            arguments: '{"city":"Tokyo"}',
          },
        },
      ],
    });
  });

  it("translates tools", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 100,
      tools: [
        {
          name: "get_weather",
          description: "Get weather info",
          input_schema: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      ],
    };

    const result = translateToOpenAI(payload);

    expect(result.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather info",
          parameters: {
            type: "object",
            properties: { city: { type: "string" } },
          },
        },
      },
    ]);
  });

  it("translates tool_choice", () => {
    expect(
      translateToOpenAI({
        model: "x",
        messages: [],
        max_tokens: 1,
        tool_choice: { type: "auto" },
      }).tool_choice
    ).toBe("auto");
    expect(
      translateToOpenAI({
        model: "x",
        messages: [],
        max_tokens: 1,
        tool_choice: { type: "any" },
      }).tool_choice
    ).toBe("required");
    expect(
      translateToOpenAI({
        model: "x",
        messages: [],
        max_tokens: 1,
        tool_choice: { type: "none" },
      }).tool_choice
    ).toBe("none");
    expect(
      translateToOpenAI({
        model: "x",
        messages: [],
        max_tokens: 1,
        tool_choice: { type: "tool", name: "foo" },
      }).tool_choice
    ).toEqual({
      type: "function",
      function: { name: "foo" },
    });
  });

  it("handles image content", () => {
    const payload: AnthropicMessagesPayload = {
      model: "claude-sonnet-4",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
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
      max_tokens: 100,
    };

    const result = translateToOpenAI(payload);

    expect(result.messages[0]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        },
      ],
    });
  });
});

describe("translateToAnthropic", () => {
  it("translates basic response", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "resp_123",
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

    expect(result.id).toBe("resp_123");
    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.content).toEqual([{ type: "text", text: "Hello there!" }]);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.usage).toEqual({ input_tokens: 10, output_tokens: 5 });
  });

  it("handles tool_calls in response", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "resp_456",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_789",
                type: "function",
                function: { name: "get_time", arguments: '{"tz":"UTC"}' },
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
        id: "call_789",
        name: "get_time",
        input: { tz: "UTC" },
      },
    ]);
    expect(result.stop_reason).toBe("tool_use");
  });

  it("maps finish_reason correctly", () => {
    const makeResponse = (
      reason: "stop" | "length" | "tool_calls" | "content_filter" | null
    ) => ({
      id: "x",
      model: "x",
      choices: [
        {
          index: 0,
          message: { role: "assistant" as const, content: "" },
          finish_reason: reason,
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
    expect(translateToAnthropic(makeResponse(null)).stop_reason).toBe(null);
  });
});

describe("translateChunkToAnthropicEvents", () => {
  it("emits message_start on first chunk", () => {
    const state = createStreamState();
    const chunk: OpenAIChatCompletionChunk = {
      id: "chunk_1",
      model: "claude-sonnet-4",
      choices: [
        { index: 0, delta: { role: "assistant" }, finish_reason: null },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 0 },
    };

    const events = translateChunkToAnthropicEvents(chunk, state);

    expect(events.length).toBe(1);
    expect(events[0].type).toBe("message_start");
    expect(state.messageStartSent).toBe(true);
  });

  it("emits content_block_start and delta for text", () => {
    const state = createStreamState();
    state.messageStartSent = true;

    const chunk: OpenAIChatCompletionChunk = {
      id: "chunk_2",
      model: "claude-sonnet-4",
      choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }],
    };

    const events = translateChunkToAnthropicEvents(chunk, state);

    expect(events.length).toBe(2);
    expect(events[0].type).toBe("content_block_start");
    expect(events[1].type).toBe("content_block_delta");
    expect((events[1] as { delta: { text: string } }).delta).toEqual({
      type: "text_delta",
      text: "Hello",
    });
  });

  it("emits message_stop on finish", () => {
    const state = createStreamState();
    state.messageStartSent = true;

    const chunk: OpenAIChatCompletionChunk = {
      id: "chunk_3",
      model: "claude-sonnet-4",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const events = translateChunkToAnthropicEvents(chunk, state);

    expect(events.some((e) => e.type === "message_delta")).toBe(true);
    expect(events.some((e) => e.type === "message_stop")).toBe(true);
  });

  it("handles tool call streaming", () => {
    const state = createStreamState();
    state.messageStartSent = true;

    // First chunk: tool call start
    const chunk1: OpenAIChatCompletionChunk = {
      id: "chunk_4",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_abc",
                function: { name: "search", arguments: "" },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    };

    const events1 = translateChunkToAnthropicEvents(chunk1, state);
    expect(events1.some((e) => e.type === "content_block_start")).toBe(true);

    // Second chunk: arguments delta
    const chunk2: OpenAIChatCompletionChunk = {
      id: "chunk_4",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [{ index: 0, function: { arguments: '{"q":' } }],
          },
          finish_reason: null,
        },
      ],
    };

    const events2 = translateChunkToAnthropicEvents(chunk2, state);
    expect(events2.some((e) => e.type === "content_block_delta")).toBe(true);
  });
});

describe("edge cases", () => {
  it("handles empty choices array", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "resp_empty",
      model: "claude-sonnet-4",
      choices: [],
      usage: { prompt_tokens: 5, completion_tokens: 0 },
    };

    const result = translateToAnthropic(response);

    expect(result.content).toEqual([]);
    expect(result.stop_reason).toBe(null);
    expect(result.usage).toEqual({ input_tokens: 5, output_tokens: 0 });
  });

  it("handles malformed tool call arguments JSON", () => {
    const response: OpenAIChatCompletionResponse = {
      id: "resp_bad",
      model: "claude-sonnet-4",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_bad",
                type: "function",
                function: { name: "broken", arguments: "not valid json {" },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };

    const result = translateToAnthropic(response);

    // Should not throw, should fall back to empty object
    expect(result.content).toEqual([
      { type: "tool_use", id: "call_bad", name: "broken", input: {} },
    ]);
  });
});
