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

describe("parseSSE", () => {
  it("parses simple data events", async () => {
    const stream = createStream(["data: hello\n\n", "data: world\n\n"]);
    const events: SSEEvent[] = [];

    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("hello");
    expect(events[1].data).toBe("world");
  });

  it("parses events with event type", async () => {
    const stream = createStream(["event: message\ndata: test\n\n"]);
    const events: SSEEvent[] = [];

    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({ event: "message", data: "test" });
  });

  it("handles chunked data", async () => {
    const stream = createStream(["dat", "a: chunked\n", "\n"]);
    const events: SSEEvent[] = [];

    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("chunked");
  });

  it("emits separate events for consecutive data lines", async () => {
    // Our SSE parser emits one event per data line (doesn't merge multi-line)
    const stream = createStream(["data: line1\ndata: line2\n\n"]);
    const events: SSEEvent[] = [];

    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(2);
    expect(events[0].data).toBe("line1");
    expect(events[1].data).toBe("line2");
  });

  it("ignores comments", async () => {
    const stream = createStream([": comment\ndata: actual\n\n"]);
    const events: SSEEvent[] = [];

    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("actual");
  });

  it("handles data without space after colon", async () => {
    const stream = createStream(["data:no-space\n\n"]);
    const events: SSEEvent[] = [];

    for await (const event of parseSSE(stream)) {
      events.push(event);
    }

    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("no-space");
  });
});

describe("transformSSE", () => {
  it("transforms events using mapper function", async () => {
    const stream = createStream([
      'data: {"value": 1}\n\n',
      'data: {"value": 2}\n\n',
    ]);

    const mapper = (_event: string | undefined, data: string) => {
      const parsed = JSON.parse(data) as { value: number };
      return [{ event: "transformed", data: String(parsed.value * 10) }];
    };

    const results: SSEEvent[] = [];
    for await (const event of transformSSE(stream, mapper)) {
      results.push(event);
    }

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ event: "transformed", data: "10" });
    expect(results[1]).toEqual({ event: "transformed", data: "20" });
  });

  it("skips events when mapper returns null", async () => {
    const stream = createStream([
      "data: keep\n\n",
      "data: skip\n\n",
      "data: keep2\n\n",
    ]);

    const mapper = (_event: string | undefined, data: string) => {
      if (data === "skip") return null;
      return [{ event: "", data }];
    };

    const results: SSEEvent[] = [];
    for await (const event of transformSSE(stream, mapper)) {
      results.push(event);
    }

    expect(results).toHaveLength(2);
    expect(results[0].data).toBe("keep");
    expect(results[1].data).toBe("keep2");
  });

  it("handles mapper returning multiple events", async () => {
    const stream = createStream(["data: expand\n\n"]);

    const mapper = () => [
      { event: "a", data: "1" },
      { event: "b", data: "2" },
    ];

    const results: SSEEvent[] = [];
    for await (const event of transformSSE(stream, mapper)) {
      results.push(event);
    }

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ event: "a", data: "1" });
    expect(results[1]).toEqual({ event: "b", data: "2" });
  });
});
