/**
 * Copilot Portal - API entry point
 */

import { Hono } from "hono";
import { health, chatCompletions, notFound, models } from "./handlers";
import { handler as messagesHandler } from "./routes/messages/handler";

const app = new Hono();

// Routes
app.get("/health", health);
app.post("/v1/chat/completions", chatCompletions);
app.post("/v1/messages", messagesHandler);
app.get("/v1/models", models);
app.all("*", notFound);

export default app;
