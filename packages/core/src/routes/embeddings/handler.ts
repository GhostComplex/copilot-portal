/**
 * POST /v1/embeddings — OpenAI embeddings passthrough
 */

import { createEmbeddings } from "../../services/copilot";
import { pipeline, openaiErrorShape } from "../../lib/proxy";

export const handleEmbeddings = pipeline("POST /v1/embeddings")
  .errorShape(openaiErrorShape)
  .body()
  .send(createEmbeddings);
