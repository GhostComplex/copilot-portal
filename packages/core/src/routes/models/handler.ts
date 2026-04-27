/**
 * GET /v1/models — List available models from Copilot API
 */

import { getModels } from "../../services/copilot";
import { pipeline, openaiErrorShape } from "../../lib/proxy";

export const handleModels = pipeline("GET /v1/models")
  .errorShape(openaiErrorShape)
  .forward(getModels);
