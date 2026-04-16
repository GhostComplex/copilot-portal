/**
 * Copilot Portal - API entry point
 */

import { Hono } from "hono";
import { env } from "hono/adapter";
import { handleChatCompletion } from "./routes/chat-completions/handler";
import { handleMessages } from "./routes/messages/handler";
import { handleModels } from "./routes/models/handler";

export function createApp() {
  const app = new Hono();

  // Health check / version
  app.get("/health", (c) => {
    const { COMMIT_SHA } = env<{ COMMIT_SHA?: string }>(c);
    return c.json({
      status: "ok",
      commit: COMMIT_SHA ?? "unknown",
    });
  });

  // OpenAI-compatible endpoints
  app.post("/v1/chat/completions", handleChatCompletion);
  app.get("/v1/models", handleModels);

  // Anthropic-compatible endpoints
  app.post("/v1/messages", handleMessages);

  // 404 fallback
  app.all("*", (c) => c.json({ error: "Not found" }, 404));

  return app;
}

const app = createApp();

export default app;
