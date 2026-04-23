/**
 * SSE (Server-Sent Events) stream utilities using Web Streams API.
 */

/**
 * A TransformStream that splits incoming text into lines,
 * handling chunks that may split across line boundaries.
 */
function lineStream(): TransformStream<string, string> {
  let buffer = "";

  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line) controller.enqueue(line);
      }
    },
    flush(controller) {
      if (buffer) controller.enqueue(buffer);
    },
  });
}

/**
 * A TransformStream that parses SSE format, extracting event type and data.
 * Handles both `event:` and `data:` fields per SSE spec.
 * Note: Per spec, space after colon is optional (e.g., both `data: x` and `data:x` are valid).
 */
function sseParseStream(): TransformStream<
  string,
  { event?: string; data: string }
> {
  let currentEvent = "";

  return new TransformStream({
    transform(line, controller) {
      if (line.startsWith("event:")) {
        // Handle both "event: x" and "event:x"
        const value = line[6] === " " ? line.slice(7) : line.slice(6);
        currentEvent = value.trim();
      } else if (line.startsWith("data:")) {
        // Handle both "data: x" and "data:x"
        const data = line[5] === " " ? line.slice(6) : line.slice(5);
        controller.enqueue({
          event: currentEvent || undefined,
          data,
        });
        currentEvent = "";
      }
      // Ignore comments (`:`) and other fields
    },
  });
}

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Parse a ReadableStream of bytes into SSE events.
 *
 * Uses Web Streams API with TransformStream pipeline:
 * bytes → text → lines → SSE events
 */
function parseSSE(body: ReadableStream<Uint8Array>): ReadableStream<SSEEvent> {
  return (body as ReadableStream<BufferSource>)
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(lineStream())
    .pipeThrough(sseParseStream());
}

/**
 * Create an SSE response by transforming upstream SSE events.
 *
 * @param c - Hono context
 * @param body - Upstream SSE stream
 * @param transform - Transform function. Return array of events to emit, or null to skip.
 */
/**
 * Serialize a complete Anthropic Messages response into SSE event text.
 * Used to replay a non-streaming response as an SSE stream.
 */
export function anthropicToSSE(response: Record<string, unknown>): string {
  const content = response.content as
    | Array<Record<string, unknown>>
    | undefined;
  const lines: string[] = [];

  const emit = (event: string, data: unknown) => {
    lines.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n`);
  };

  const messageShell = { ...response };
  delete messageShell.content;
  emit("message_start", {
    type: "message_start",
    message: { ...messageShell, content: [] },
  });

  if (content) {
    for (let i = 0; i < content.length; i++) {
      const block = content[i];
      emit("content_block_start", {
        type: "content_block_start",
        index: i,
        content_block:
          block.type === "text" ? { type: "text", text: "" } : block,
      });

      if (block.type === "text" && typeof block.text === "string") {
        emit("content_block_delta", {
          type: "content_block_delta",
          index: i,
          delta: { type: "text_delta", text: block.text },
        });
      }

      emit("content_block_stop", { type: "content_block_stop", index: i });
    }
  }

  emit("message_delta", {
    type: "message_delta",
    delta: { stop_reason: response.stop_reason ?? "end_turn" },
    usage: response.usage ?? {},
  });
  emit("message_stop", { type: "message_stop" });

  return lines.join("\n");
}

export async function* transformSSE(
  body: ReadableStream<Uint8Array>,
  transform: (event: string | undefined, data: string) => SSEEvent[] | null
): AsyncGenerator<SSEEvent> {
  const reader = parseSSE(body).getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const results = transform(value.event, value.data);
      if (results) {
        for (const e of results) {
          yield e;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
