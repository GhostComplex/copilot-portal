/**
 * Copilot token exchange and request forwarding.
 *
 * Flow:
 *   GitHub PAT  →  POST api.github.com/copilot_internal/v2/token  →  Copilot JWT (~30 min)
 *   Copilot JWT →  POST api.githubcopilot.com/chat/completions     →  SSE stream
 *
 * The Copilot JWT is cached in-memory per GitHub token hash, refreshed 5 min before expiry.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COPILOT_VERSION = "0.38.2";
const EDITOR_PLUGIN_VERSION = `copilot-chat/${COPILOT_VERSION}`;
const USER_AGENT = `GitHubCopilotChat/${COPILOT_VERSION}`;
const FALLBACK_EDITOR_VERSION = "vscode/1.110.1";
const API_VERSION = "2025-10-01";

const GITHUB_TOKEN_URL = "https://api.github.com/copilot_internal/v2/token";
const COPILOT_CHAT_URL = "https://api.githubcopilot.com/chat/completions";
const VSCODE_RELEASES_URL = "https://update.code.visualstudio.com/api/releases/stable";

const REFRESH_MARGIN_SEC = 5 * 60; // refresh token 5 min before expiry
const VSCODE_VERSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // cache VS Code version for 7 days
const VSCODE_FALLBACK_TTL_MS = 10 * 60 * 1000; // fallback version only cached for 10min

// ---------------------------------------------------------------------------
// VS Code Version (dynamic with 7-day cache, 10min for fallback)
// ---------------------------------------------------------------------------

let cachedVSCodeVersion: string | null = null;
let vscodeVersionExpiresAt = 0;

/** Reset VS Code version cache (for testing) */
export function resetVSCodeVersionCache(): void {
  cachedVSCodeVersion = null;
  vscodeVersionExpiresAt = 0;
}

/** Fetch and cache VS Code version, returns full "vscode/x.y.z" string */
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
    if (Array.isArray(releases) && releases.length > 0 && typeof releases[0] === "string") {
      cachedVSCodeVersion = `vscode/${releases[0]}`;
      vscodeVersionExpiresAt = now + VSCODE_VERSION_TTL_MS;
      return cachedVSCodeVersion;
    }
    throw new Error("Invalid response format");
  } catch (e) {
    console.warn(
      `Failed to fetch VS Code version: ${e instanceof Error ? e.message : String(e)}, using fallback`,
    );
    // Use fallback with shorter TTL so we retry sooner
    cachedVSCodeVersion = FALLBACK_EDITOR_VERSION;
    vscodeVersionExpiresAt = now + VSCODE_FALLBACK_TTL_MS;
    return cachedVSCodeVersion;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Error with status code for retry logic */
export class HttpError extends Error {
  constructor(
    message: string,
    public statusCode: number,
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
// Retry with exponential backoff
// ---------------------------------------------------------------------------

function isClientError(e: unknown): boolean {
  if (e instanceof Error && "statusCode" in e) {
    const code = (e as { statusCode: number }).statusCode;
    return code >= 400 && code < 500;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      // Don't retry client errors (4xx) — they won't change on retry
      if (isClientError(e)) throw e;
      if (attempt >= maxRetries) throw e;

      const delay = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `Retry ${attempt + 1}/${maxRetries} after ${delay}ms: ${e instanceof Error ? e.message : String(e)}`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("Unreachable");
}

// ---------------------------------------------------------------------------
// Headers builder
// ---------------------------------------------------------------------------

export async function buildCopilotHeaders(copilotToken: string): Promise<Record<string, string>> {
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
  };
}

export async function buildGitHubHeaders(): Promise<Record<string, string>> {
  const editorVersion = await fetchVSCodeVersion();
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": USER_AGENT,
    "Editor-Version": editorVersion,
    "Editor-Plugin-Version": EDITOR_PLUGIN_VERSION,
    "X-GitHub-Api-Version": API_VERSION,
  };
}

// ---------------------------------------------------------------------------
// In-memory token cache (per-isolate; cleared on worker recycle)
// Uses SHA-256 hash of PAT as cache key to avoid storing raw tokens in memory
// ---------------------------------------------------------------------------

export interface CachedToken {
  token: string;
  expiresAt: number; // unix seconds
}

const tokenCache = new Map<string, CachedToken>();

/** Hash a token using SHA-256 (CF Workers compatible) */
async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function isTokenValid(cached: CachedToken | undefined, now: number): boolean {
  return !!cached && cached.expiresAt - REFRESH_MARGIN_SEC > now;
}

/** Clear token cache (for testing) */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * Returns a valid Copilot token for the given GitHub PAT.
 * Uses an in-memory cache (keyed by PAT hash) and refreshes 5 min before expiry.
 */
export async function getCopilotToken(githubToken: string): Promise<string> {
  const cacheKey = await hashToken(githubToken);
  const cached = tokenCache.get(cacheKey);
  const now = Math.floor(Date.now() / 1000);

  if (isTokenValid(cached, now)) {
    return cached!.token;
  }

  return withRetry(async () => {
    const headers = await buildGitHubHeaders();
    const res = await fetch(GITHUB_TOKEN_URL, {
      method: "GET",
      headers: {
        ...headers,
        Authorization: `token ${githubToken}`,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new TokenExchangeError(
        `GitHub token exchange failed (${res.status}): ${body}`,
        res.status,
      );
    }

    const data = (await res.json()) as { token: string; expires_at: number };

    tokenCache.set(cacheKey, {
      token: data.token,
      expiresAt: data.expires_at,
    });

    return data.token;
  });
}

// ---------------------------------------------------------------------------
// Chat completions forwarding
// ---------------------------------------------------------------------------

/**
 * Forward a chat completions request to the Copilot API.
 * Returns the raw Response (including streaming body) so the caller can
 * pipe it directly to the client.
 */
export async function forwardChatCompletions(
  copilotToken: string,
  body: string,
): Promise<Response> {
  const headers = await buildCopilotHeaders(copilotToken);
  return fetch(COPILOT_CHAT_URL, {
    method: "POST",
    headers,
    body,
  });
}
