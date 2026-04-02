/**
 * Copilot Shadow — Hono app on Cloudflare Workers.
 *
 * Routes:
 *   GET  /health                  → health check
 *   POST /v1/chat/completions     → OpenAI-compatible chat completions passthrough
 */

import { Hono } from "hono";
import { health, chatCompletions, notFound } from "./handlers";

const app = new Hono();

app.get("/health", health);
app.post("/v1/chat/completions", chatCompletions);
app.all("*", notFound);

export default app;
