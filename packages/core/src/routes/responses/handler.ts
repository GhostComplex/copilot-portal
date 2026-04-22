/**
 * POST /v1/responses — OpenAI Responses API passthrough
 */

import type { Context } from "hono";
import { createResponses } from "../../services/copilot";
import { proxyPassthrough, openaiErrorShape } from "../../lib/proxy";

export const handleResponses = (c: Context) =>
  proxyPassthrough(c, {
    routeName: "POST /v1/responses",
    errorShape: openaiErrorShape,
    call: createResponses,
  });
