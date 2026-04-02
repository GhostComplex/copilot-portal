/**
 * Copilot Portal - API entry point
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

// Routes
app.get("/health", health);
app.post("/v1/chat/completions", chatCompletions);
app.post("/v1/messages", messages);
app.get("/v1/models", models);
app.all("*", notFound);

export default app;
