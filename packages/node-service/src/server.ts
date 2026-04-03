import { serve } from "@hono/node-server";
import app from "@copilot-portal/core";

const DEFAULT_PORT = 3000;

function resolvePort(rawPort: string | undefined): number {
  if (!rawPort) return DEFAULT_PORT;

  const parsed = Number.parseInt(rawPort, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_PORT;
  }

  return parsed;
}

const port = resolvePort(process.env.PORT);

serve({
  fetch: app.fetch,
  port,
});

console.log(`Copilot Portal Node service listening on port ${port}`);
