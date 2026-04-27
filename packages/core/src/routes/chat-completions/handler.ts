/**
 * POST /v1/chat/completions — OpenAI-compatible chat completions passthrough
 */

import { createChatCompletions } from "../../services/copilot";
import { pipeline, openaiErrorShape } from "../../lib/proxy";

export const handleChatCompletion = pipeline("POST /v1/chat/completions")
  .errorShape(openaiErrorShape)
  .translate()
  .send(createChatCompletions);
