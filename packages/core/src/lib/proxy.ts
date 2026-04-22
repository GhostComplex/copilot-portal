/**
 * Shared proxy primitives: auth-header parsing, error-shape adapters,
 * and the passthrough pipeline used by /v1/* handlers.
 */

import type { Context } from "hono";
import { getCopilotToken, TokenExchangeError } from "../services/copilot";

/**
 * Extract token from Authorization header.
 * Only accepts "Bearer <token>" or "token <token>" schemes.
 * Rejects Basic, Digest, etc.
 */
export function extractToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const parts = authHeader.split(" ");
  if (parts.length === 2) {
    const scheme = parts[0].toLowerCase();
    if (scheme === "bearer" || scheme === "token") {
      return parts[1];
    }
  }
  return null;
}

export interface ErrorShape {
  auth(message: string): unknown;
  tokenExchange(message: string): unknown;
  upstream(message: string): unknown;
}

export const openaiErrorShape: ErrorShape = {
  auth: (m) => ({ error: m }),
  tokenExchange: (m) => ({ error: "Token exchange failed", detail: m }),
  upstream: (m) => ({ error: "Upstream error", detail: m }),
};

export const anthropicErrorShape: ErrorShape = {
  auth: (m) => ({
    type: "error",
    error: { type: "authentication_error", message: m },
  }),
  tokenExchange: (m) => ({
    type: "error",
    error: { type: "authentication_error", message: m },
  }),
  upstream: (m) => ({
    type: "error",
    error: { type: "api_error", message: m },
  }),
};

export interface ProxyOptions {
  routeName: string;
  errorShape: ErrorShape;
  call: (copilotToken: string, body: string) => Promise<Response>;
  prepareBody?: (raw: string) => string;
}

export type WithCopilotTokenResult =
  | { ok: true; copilotToken: string; requestId: string }
  | { ok: false; response: Response };

export async function withCopilotToken(
  c: Context,
  routeName: string,
  errorShape: ErrorShape
): Promise<WithCopilotTokenResult> {
  const requestId = crypto.randomUUID().slice(0, 8);

  const githubToken = extractToken(c.req.header("Authorization"));
  if (!githubToken) {
    console.warn(`[${requestId}] ${routeName} — 401 missing auth`);
    return {
      ok: false,
      response: c.json(
        errorShape.auth("Missing or malformed Authorization header"),
        401
      ),
    };
  }

  try {
    const copilotToken = await getCopilotToken(githubToken);
    return { ok: true, copilotToken, requestId };
  } catch (err) {
    if (err instanceof TokenExchangeError) {
      console.error(`[${requestId}] Token exchange failed: ${err.message}`);
      return {
        ok: false,
        response: c.json(
          errorShape.tokenExchange(err.message),
          err.statusCode as 401 | 403 | 500
        ),
      };
    }
    throw err;
  }
}

export async function proxyPassthrough(c: Context, opts: ProxyOptions) {
  const result = await withCopilotToken(c, opts.routeName, opts.errorShape);
  if (!result.ok) return result.response;
  const { copilotToken, requestId } = result;

  const raw = await c.req.text();
  const body = opts.prepareBody ? opts.prepareBody(raw) : raw;
  console.log(`[${requestId}] ${opts.routeName}`);
  const upstream = await opts.call(copilotToken, body);

  if (!upstream.ok) {
    const errorText = await upstream.text();
    console.error(
      `[${requestId}] Upstream error ${upstream.status}: ${errorText}`
    );
    return c.json(
      opts.errorShape.upstream(errorText),
      upstream.status as 400 | 401 | 403 | 500 | 502
    );
  }

  const headers = new Headers();
  const ct = upstream.headers.get("Content-Type");
  if (ct) headers.set("Content-Type", ct);
  if (ct?.includes("text/event-stream")) {
    headers.set("Cache-Control", "no-cache");
    headers.set("Connection", "keep-alive");
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}
