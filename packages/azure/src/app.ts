/**
 * Copilot Portal - Hono app (shared logic)
 */

import { Hono } from "hono";
import { handleChatCompletion } from "./routes/chat-completions/handler";
import { handleMessages } from "./routes/messages/handler";
import { handleModels } from "./routes/models/handler";

const app = new Hono();

// Health check
app.get("/health", (c) => c.json({ status: "ok" }));

// OpenAI-compatible endpoints
app.post("/v1/chat/completions", handleChatCompletion);
app.get("/v1/models", handleModels);

// Anthropic-compatible endpoints
app.post("/v1/messages", handleMessages);

// 404 fallback
app.all("*", (c) => c.json({ error: "Not found" }, 404));

export default app;
