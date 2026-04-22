/**
 * POST /v1/embeddings — OpenAI embeddings passthrough
 */

import type { Context } from "hono";
import { createEmbeddings } from "../../services/copilot";
import { proxyPassthrough, openaiErrorShape } from "../../lib/proxy";

export const handleEmbeddings = (c: Context) =>
  proxyPassthrough(c, {
    routeName: "POST /v1/embeddings",
    errorShape: openaiErrorShape,
    call: createEmbeddings,
  });
