/**
 * Copilot service: token exchange and chat completions.
 *
 * Combines GitHub token exchange and Copilot API forwarding.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GITHUB_API_BASE_URL = "https://api.github.com";
const COPILOT_API_BASE_URL = "https://api.githubcopilot.com";

const COPILOT_VERSION = "0.38.2";
const EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`;
const USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`;
const FALLBACK_EDITOR_VERSION = "vscode/1.110.1";
const API_VERSION = "2025-10-01";

const VSCODE_RELEASES_URL =
  "https://update.code.visualstudio.com/api/releases/stable";
const VSCODE_VERSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const VSCODE_FALLBACK_TTL_MS = 10 * 60 * 1000; // 10 min
const TOKEN_REFRESH_MARGIN_MS = 60_000; // refresh 60s before expiry

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class HttpError extends Error {
  constructor(
    message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class TokenExchangeError extends HttpError {
  constructor(message: string, statusCode: number) {
    super(message, statusCode);
    this.name = "TokenExchangeError";
  }
}

// ---------------------------------------------------------------------------
// VS Code Version (dynamic with 7-day cache)
// ---------------------------------------------------------------------------

let cachedVSCodeVersion: string | null = null;
let vscodeVersionExpiresAt = 0;

/** Reset VS Code version cache (for testing) */
export function resetVSCodeVersionCache(): void {
  cachedVSCodeVersion = null;
  vscodeVersionExpiresAt = 0;
}

async function fetchVSCodeVersion(): Promise<string> {
  const now = Date.now();
  if (cachedVSCodeVersion && vscodeVersionExpiresAt > now) {
    return cachedVSCodeVersion;
  }

  try {
    const resp = await fetch(VSCODE_RELEASES_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const releases = (await resp.json()) as string[];
    if (Array.isArray(releases) && releases.length > 0) {
      cachedVSCodeVersion = `vscode/${releases[0]}`;
      vscodeVersionExpiresAt = now + VSCODE_VERSION_TTL_MS;
      return cachedVSCodeVersion;
    }
    throw new Error("Invalid response format");
  } catch {
    cachedVSCodeVersion = FALLBACK_EDITOR_VERSION;
    vscodeVersionExpiresAt = now + VSCODE_FALLBACK_TTL_MS;
    return cachedVSCodeVersion;
  }
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

async function buildCopilotHeaders(
  copilotToken: string,
  extra?: Record<string, string>
): Promise<Record<string, string>> {
  const editorVersion = await fetchVSCodeVersion();
  return {
    Authorization: `Bearer ${copilotToken}`,
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "Editor-Version": editorVersion,
    "Editor-Plugin-Version": EDITOR_PLUGIN_VERSION,
    "X-GitHub-Api-Version": API_VERSION,
    "Copilot-Integration-Id": "vscode-chat",
    "Openai-Intent": "conversation-panel",
    ...extra,
  };
}

/**
 * Filter the client's `anthropic-beta` header down to betas that are
 * supported by the Copilot upstream for the given model. Returns
 * `undefined` if nothing remains.
 *
 * - `context-management-2025-06-27` and `advanced-tool-use-2025-11-20`
 *   are universally supported.
 * - `interleaved-thinking-2025-05-14` is supported on all Claude models
 *   except `claude-opus-4.7*`, which rejects it.
 */
export function filterAnthropicBeta(
  raw: string | undefined | null,
  model?: string
): string | undefined {
  if (!raw) return undefined;
  const isOpus47 = model?.startsWith("claude-opus-4.7") ?? false;
  const kept = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => {
      if (s === "context-management-2025-06-27") return true;
      if (s === "advanced-tool-use-2025-11-20") return true;
      if (s === "interleaved-thinking-2025-05-14") return !isOpus47;
      return false;
    });
  return kept.length > 0 ? kept.join(",") : undefined;
}

function buildGitHubHeaders(githubToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `token ${githubToken}`,
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": API_VERSION,
  };
}

// ---------------------------------------------------------------------------
// Token Cache
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number;
}

const tokenCache = new Map<string, CachedToken>();

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function isTokenValid(
  cached: CachedToken | undefined,
  now: number
): boolean {
  return !!cached && cached.expiresAt > now;
}

export function clearTokenCache(): void {
  tokenCache.clear();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GetCopilotTokenResponse {
  expires_at: number;
  refresh_in: number;
  token: string;
}

/**
 * Exchange GitHub OAuth token for Copilot token.
 * Results are cached until expiry.
 */
export async function getCopilotToken(githubToken: string): Promise<string> {
  const cacheKey = await hashToken(githubToken);
  const cached = tokenCache.get(cacheKey);
  const now = Date.now();

  if (isTokenValid(cached, now)) {
    return cached!.token;
  }

  const response = await fetch(
    `${GITHUB_API_BASE_URL}/copilot_internal/v2/token`,
    { headers: buildGitHubHeaders(githubToken) }
  );

  if (!response.ok) {
    const body = await response.text();
    const statusCode =
      response.status === 401 || response.status === 403
        ? response.status
        : 500;
    throw new TokenExchangeError(
      `GitHub token exchange failed (${response.status}): ${body}`,
      statusCode
    );
  }

  const data = (await response.json()) as GetCopilotTokenResponse;

  tokenCache.set(cacheKey, {
    token: data.token,
    expiresAt: data.expires_at * 1000 - TOKEN_REFRESH_MARGIN_MS,
  });

  return data.token;
}

/**
 * Forward chat completions request to Copilot API.
 * Returns raw Response for streaming support.
 */
export async function createChatCompletions(
  copilotToken: string,
  body: string
): Promise<Response> {
  const headers = await buildCopilotHeaders(copilotToken);
  return fetch(`${COPILOT_API_BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Forward Anthropic messages request to Copilot API.
 * Returns raw Response for streaming support.
 */
export async function createMessages(
  copilotToken: string,
  body: string,
  anthropicBeta?: string
): Promise<Response> {
  const extra = anthropicBeta ? { "anthropic-beta": anthropicBeta } : undefined;
  const headers = await buildCopilotHeaders(copilotToken, extra);
  return fetch(`${COPILOT_API_BASE_URL}/v1/messages`, {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Get available models from Copilot API.
 */
export async function getModels(copilotToken: string): Promise<Response> {
  const headers = await buildCopilotHeaders(copilotToken);
  return fetch(`${COPILOT_API_BASE_URL}/models`, {
    method: "GET",
    headers,
  });
}
