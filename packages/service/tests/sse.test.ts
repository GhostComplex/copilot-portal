/**
 * Tests for SSE utilities.
 */

import { describe, it, expect } from "vitest";
import { parseSSE, transformSSE, type SSEEvent } from "../src/lib/sse";

function createStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const results: T[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    results.push(value);
  }

  return results;
}

describe("parseSSE", () => {
  it("parses simple data events", async () => {
    const stream = createStream(["data: hello\n", "data: world\n"]);
    const events = await collectStream(parseSSE(stream));

    expect(events).toEqual([
      { event: undefined, data: "hello" },
      { event: undefined, data: "world" },
    ]);
  });

  it("parses events with event field", async () => {
    const stream = createStream([
      "event: message_start\n",
      'data: {"type":"start"}\n',
      "event: content\n",
      'data: {"type":"delta"}\n',
    ]);
    const events = await collectStream(parseSSE(stream));

    expect(events).toEqual([
      { event: "message_start", data: '{"type":"start"}' },
      { event: "content", data: '{"type":"delta"}' },
    ]);
  });

  it("handles chunked data across boundaries", async () => {
    const stream = createStream(["data: hel", "lo\ndata: wo", "rld\n"]);
    const events = await collectStream(parseSSE(stream));

    expect(events).toEqual([
      { event: undefined, data: "hello" },
      { event: undefined, data: "world" },
    ]);
  });

  it("resets event after yielding", async () => {
    const stream = createStream([
      "event: first\n",
      "data: one\n",
      "data: two\n",
    ]);
    const events = await collectStream(parseSSE(stream));

    expect(events).toEqual([
      { event: "first", data: "one" },
      { event: undefined, data: "two" },
    ]);
  });

  it("ignores comments and empty lines", async () => {
    const stream = createStream([": comment\n", "\n", "data: actual\n"]);
    const events = await collectStream(parseSSE(stream));

    expect(events).toEqual([{ event: undefined, data: "actual" }]);
  });

  it("handles data without space after colon (SSE spec)", async () => {
    const stream = createStream([
      "data:no-space\n",
      "event:myevent\n",
      "data:with-event\n",
    ]);
    const events = await collectStream(parseSSE(stream));

    expect(events).toEqual([
      { event: undefined, data: "no-space" },
      { event: "myevent", data: "with-event" },
    ]);
  });
});

describe("transformSSE", () => {
  it("transforms events", async () => {
    const stream = createStream(["data: hello\n", "data: world\n"]);

    const results: SSEEvent[] = [];
    for await (const e of transformSSE(stream, (_event, data) => [
      { data: data.toUpperCase() },
    ])) {
      results.push(e);
    }

    expect(results).toEqual([{ data: "HELLO" }, { data: "WORLD" }]);
  });

  it("filters events returning null", async () => {
    const stream = createStream([
      "data: keep\n",
      "data: [DONE]\n",
      "data: also keep\n",
    ]);

    const results: SSEEvent[] = [];
    for await (const e of transformSSE(stream, (_event, data) =>
      data === "[DONE]" ? null : [{ data }]
    )) {
      results.push(e);
    }

    expect(results).toEqual([{ data: "keep" }, { data: "also keep" }]);
  });

  it("expands one event to multiple", async () => {
    const stream = createStream(["data: x\n"]);

    const results: SSEEvent[] = [];
    for await (const e of transformSSE(stream, () => [
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ])) {
      results.push(e);
    }

    expect(results).toEqual([
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ]);
  });
});
