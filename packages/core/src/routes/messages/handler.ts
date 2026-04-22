/**
 * POST /v1/messages — Anthropic Messages API passthrough
 */

import type { Context } from "hono";
import { createMessages } from "../../services/copilot";
import { proxyPassthrough, anthropicErrorShape } from "../../lib/proxy";
import { rewriteRequestBody, filterAnthropicBeta } from "./translate";

export function handleMessages(c: Context) {
  const anthropicBeta = filterAnthropicBeta(c.req.header("anthropic-beta"));
  return proxyPassthrough(c, {
    routeName: "POST /v1/messages",
    errorShape: anthropicErrorShape,
    prepareBody: (raw) => rewriteRequestBody(raw).body,
    call: (token, body) => createMessages(token, body, anthropicBeta),
  });
}
