/**
 * Azure Functions HTTP trigger for Copilot Portal
 */

import { app } from "@azure/functions";
import { azureHonoHandler } from "@marplex/hono-azurefunc-adapter";
import { createApp } from "@copilot-portal/core";

const honoApp = createApp();

app.http("httpTrigger", {
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  authLevel: "anonymous",
  route: "{*proxy}",
  handler: azureHonoHandler(honoApp.fetch),
});
