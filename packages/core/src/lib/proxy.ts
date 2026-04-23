/**
 * Shared proxy primitives: auth-header parsing, error-shape adapters,
 * and the pipeline builder used by /v1/* handlers.
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

// ---------------------------------------------------------------------------
// Pipeline context — flows through each step
// ---------------------------------------------------------------------------

export interface PipelineContext {
  c: Context;
  copilotToken: string;
  requestId: string;
  body: string;
  parsed: Record<string, unknown> | null;
  headers: Record<string, string | undefined>;
}

// ---------------------------------------------------------------------------
// Response forwarding
// ---------------------------------------------------------------------------

export async function forwardUpstream(
  c: Context,
  upstream: Response,
  errorShape: ErrorShape,
  requestId: string
) {
  if (!upstream.ok) {
    const errorText = await upstream.text();
    console.error(
      `[${requestId}] Upstream error ${upstream.status}: ${errorText}`
    );
    return c.json(
      errorShape.upstream(errorText),
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

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Pipeline builder
// ---------------------------------------------------------------------------

type HeaderTransform = (val: string | undefined) => string | undefined;

type BodyTransform = (raw: string) => { body: string } | string;

type InterceptHandler = (ctx: PipelineContext) => Promise<Response>;

type SendFn = (
  copilotToken: string,
  body: string,
  ...extra: (string | undefined)[]
) => Promise<Response>;

interface PipelineConfig {
  routeName: string;
  errorShape: ErrorShape;
  headerTransform: { name: string; transform: HeaderTransform }[];
  bodyTransform: BodyTransform | null;
  intercept: {
    detect: (parsed: Record<string, unknown> | null) => boolean;
    handle: InterceptHandler;
  } | null;
  needsBody: boolean;
}

class Pipeline {
  private config: PipelineConfig;

  constructor(routeName: string) {
    this.config = {
      routeName,
      errorShape: openaiErrorShape,
      headerTransform: [],
      bodyTransform: null,
      intercept: null,
      needsBody: false,
    };
  }

  errorShape(errorShape: ErrorShape): this {
    this.config.errorShape = errorShape;
    return this;
  }

  header(name: string, transform: HeaderTransform): this {
    this.config.headerTransform.push({ name, transform });
    return this;
  }

  body(transform?: BodyTransform): this {
    this.config.needsBody = true;
    if (transform) this.config.bodyTransform = transform;
    return this;
  }

  intercept(
    detect: (parsed: Record<string, unknown> | null) => boolean,
    handle: InterceptHandler
  ): this {
    this.config.intercept = { detect, handle };
    return this;
  }

  send(call: SendFn): (c: Context) => Promise<Response> {
    const cfg = { ...this.config };

    return async (c: Context) => {
      const auth = await withCopilotToken(c, cfg.routeName, cfg.errorShape);
      if (!auth.ok) return auth.response;
      const { copilotToken, requestId } = auth;

      const headers: Record<string, string | undefined> = {};
      for (const { name, transform } of cfg.headerTransform) {
        headers[name] = transform(c.req.header(name));
      }

      let body = "";
      let parsed: Record<string, unknown> | null = null;

      if (cfg.needsBody) {
        const raw = await c.req.text();
        if (cfg.bodyTransform) {
          const result = cfg.bodyTransform(raw);
          body = typeof result === "string" ? result : result.body;
        } else {
          body = raw;
        }
        try {
          parsed = JSON.parse(body);
        } catch {
          // invalid JSON — let upstream handle the error
        }
      }

      const ctx: PipelineContext = {
        c,
        copilotToken,
        requestId,
        body,
        parsed,
        headers,
      };

      if (cfg.intercept?.detect(parsed)) {
        return cfg.intercept.handle(ctx);
      }

      console.log(`[${requestId}] ${cfg.routeName}`);

      const extraArgs = cfg.headerTransform.map(({ name }) => headers[name]);
      const upstream = await call(copilotToken, body, ...extraArgs);
      return forwardUpstream(c, upstream, cfg.errorShape, requestId);
    };
  }
}

export function pipeline(routeName: string): Pipeline {
  return new Pipeline(routeName);
}
