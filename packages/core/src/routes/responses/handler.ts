/**
 * POST /v1/responses — OpenAI Responses API passthrough
 */

import { createResponses } from "../../services/copilot";
import { pipeline, openaiErrorShape } from "../../lib/proxy";

export const handleResponses = pipeline("POST /v1/responses")
  .errorShape(openaiErrorShape)
  .translate()
  .forward(createResponses);
