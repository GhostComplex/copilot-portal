/**
 * Copilot Portal - API entry point
 */

import { Hono } from "hono";
import { handleChatCompletion } from "./routes/chat-completions";
import { handleMessages } from "./routes/messages/handler";

const app = new Hono();

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// OpenAI-compatible endpoints
app.post("/v1/chat/completions", handleChatCompletion);

// Anthropic-compatible endpoints
app.post("/v1/messages", handleMessages);

// Models list
app.get("/v1/models", (c) => {
  const models = [
    { id: "claude-opus-4", object: "model", owned_by: "anthropic" },
    { id: "claude-sonnet-4", object: "model", owned_by: "anthropic" },
    { id: "gpt-4o", object: "model", owned_by: "openai" },
    { id: "gpt-4o-mini", object: "model", owned_by: "openai" },
    { id: "o1", object: "model", owned_by: "openai" },
    { id: "o3-mini", object: "model", owned_by: "openai" },
  ];
  return c.json({ object: "list", data: models });
});

// 404 fallback
app.all("*", (c) => c.json({ error: "Not found" }, 404));

export default app;
