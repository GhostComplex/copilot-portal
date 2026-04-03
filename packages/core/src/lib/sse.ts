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
export function parseSSE(
  body: ReadableStream<Uint8Array>
): ReadableStream<SSEEvent> {
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
