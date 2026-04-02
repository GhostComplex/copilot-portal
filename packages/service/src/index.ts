/**
 * Copilot Gate — Hono app on Cloudflare Workers.
 *
 * Routes:
 *   GET  /health                  → health check
 *   POST /v1/chat/completions     → OpenAI-compatible chat completions passthrough
 *   POST /v1/messages             → Anthropic Messages API compatible endpoint
 *   GET  /v1/models               → List available models
 */

import { Hono } from "hono";
import {
  health,
  chatCompletions,
  messages,
  models,
  notFound,
} from "./handlers";

const app = new Hono();

app.get("/health", health);
app.post("/v1/chat/completions", chatCompletions);
app.post("/v1/messages", messages);
app.get("/v1/models", models);
app.all("*", notFound);

export default app;
