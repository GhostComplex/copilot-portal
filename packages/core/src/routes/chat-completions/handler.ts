/**
 * POST /v1/chat/completions — OpenAI-compatible chat completions passthrough
 */

import type { Context } from "hono";
import { createChatCompletions } from "../../services/copilot";
import { proxyPassthrough, openaiErrorShape } from "../../lib/proxy";

export const handleChatCompletion = (c: Context) =>
  proxyPassthrough(c, {
    routeName: "POST /v1/chat/completions",
    errorShape: openaiErrorShape,
    call: createChatCompletions,
  });
