/**
 * Web search interception for POST /v1/messages.
 *
 * Copilot upstream rejects Anthropic's web_search server tool. We convert
 * it into an equivalent function tool so the model knows it can search,
 * then intercept the tool_use call, execute the query via the Copilot
 * /responses API, and inject results back as text for the model to use.
 */

import {
  createMessages,
  searchViaResponses,
  type WebSearchResult,
} from "../../services/copilot";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  [key: string]: unknown;
}

interface AnthropicMessage {
  role: string;
  content: string | ContentBlock[];
}

export interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: ContentBlock[];
  stop_reason: string | null;
  usage: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Detection & conversion
// ---------------------------------------------------------------------------

const WEB_SEARCH_NAME = "web_search";

export function hasWebSearchTool(
  tools: Record<string, unknown>[] | undefined
): boolean {
  return !!tools?.some((t) => t.name === WEB_SEARCH_NAME);
}

const WEB_SEARCH_FUNCTION_TOOL = {
  name: WEB_SEARCH_NAME,
  description:
    "Search the web for current information. Returns search results with titles, URLs, and snippets.",
  input_schema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
  },
};

function convertTools(
  tools: Record<string, unknown>[]
): Record<string, unknown>[] {
  return tools.map((t) =>
    t.name === WEB_SEARCH_NAME ? WEB_SEARCH_FUNCTION_TOOL : t
  );
}

// ---------------------------------------------------------------------------
// Search result formatting
// ---------------------------------------------------------------------------

function formatSearchResults(results: WebSearchResult[]): ContentBlock {
  const text = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`)
    .join("\n\n");
  return { type: "text", text };
}

// ---------------------------------------------------------------------------
// Core loop
// ---------------------------------------------------------------------------

const MAX_TOOL_LOOPS = 1;

export async function withWebSearch(
  copilotToken: string,
  parsed: Record<string, unknown>,
  inboundHeaders: Record<string, string | undefined> = {}
): Promise<AnthropicResponse> {
  const messages = [...((parsed.messages as AnthropicMessage[]) ?? [])];

  const payload = { ...parsed };
  payload.tools = convertTools(
    (parsed.tools as Record<string, unknown>[]) ?? []
  );

  for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
    payload.messages = messages;
    payload.stream = false;

    const upstream = await createMessages(
      copilotToken,
      JSON.stringify(payload),
      inboundHeaders
    );

    if (!upstream.ok) {
      const errText = await upstream.text();
      throw new Error(`Upstream error ${upstream.status}: ${errText}`);
    }

    const response = (await upstream.json()) as AnthropicResponse;

    const toolUse = response.content?.find(
      (b) => b.type === "tool_use" && b.name === WEB_SEARCH_NAME
    );

    if (!toolUse) return response;

    const query = String(
      (toolUse as Record<string, Record<string, unknown>>).input?.query ?? ""
    );
    const results = await searchViaResponses(copilotToken, query);

    const assistantContent = response.content.filter(
      (b) => b.type !== "tool_use"
    );
    if (assistantContent.length === 0) {
      assistantContent.push({ type: "text", text: "Searching the web..." });
    }
    messages.push({
      role: "assistant",
      content: assistantContent,
    });

    const searchText = formatSearchResults(results).text as string;
    messages.push({
      role: "user",
      content: `Here are the web search results:\n\n${searchText}\n\nPlease answer the user's question based on these search results.`,
    });
  }

  // Remove web_search tool for the final call since results are injected as text
  const remainingTools = (payload.tools as Record<string, unknown>[]).filter(
    (t) => t.name !== WEB_SEARCH_NAME
  );
  if (remainingTools.length > 0) {
    payload.tools = remainingTools;
  } else {
    delete payload.tools;
    delete payload.tool_choice;
  }
  payload.messages = messages;
  payload.stream = false;

  const final = await createMessages(
    copilotToken,
    JSON.stringify(payload),
    inboundHeaders
  );
  if (!final.ok) {
    const errText = await final.text();
    throw new Error(`Upstream error ${final.status}: ${errText}`);
  }
  const finalResponse = (await final.json()) as AnthropicResponse;

  // If the model still wants to search, strip tool_use blocks and force end_turn
  if (finalResponse.stop_reason === "tool_use") {
    finalResponse.content = finalResponse.content.filter(
      (b) => b.type !== "tool_use"
    );
    if (finalResponse.content.length === 0) {
      finalResponse.content = [
        { type: "text", text: "I was unable to complete the web search." },
      ];
    }
    finalResponse.stop_reason = "end_turn";
  }
  return finalResponse;
}
