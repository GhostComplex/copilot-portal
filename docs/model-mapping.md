# `/v1/messages` Model & Beta Mapping

How copilot-portal rewrites the request body and `anthropic-beta` header before forwarding to `api.githubcopilot.com`.

## Rules currently applied (in order)

Defined in `packages/core/src/routes/messages/translate.ts`.

1. **Default `max_tokens`** — inject `16384` if absent.
2. **`claude-opus-4.7` thinking fix** — when model starts with `claude-opus-4.7` and `thinking.type === "enabled"`, rewrite to `thinking.type = "adaptive"` (drop `budget_tokens`). Upstream rejects `enabled` only on 4.7. `output_config.effort` is **not** injected — clients control effort themselves.
3. **Strip `output_config.format`** — Anthropic Structured Outputs (`output_config.format`) is rejected by the Copilot upstream with 400 regardless of beta header. Some SDKs auto-inject this field with no client-level opt-out, so the proxy strips it. `output_config.effort` is preserved.
4. **Beta header blocklist** (`filterAnthropicBeta`) — drop only:
   - `context-1m-2025-08-07` (upstream rejects it)

   All other betas are forwarded as-is.

## Design: how the rewrite pipeline works

copilot-portal is a **transparent proxy**: the request body is forwarded mostly as-is, with a small set of known-problematic fields stripped or rewritten. Per the principle in `CLAUDE.md`, the portal does not parse and rebuild requests — unknown fields pass through untouched so new upstream features are auto-supported.

```
  Client request body
  ┌──────────────────────────────────┐
  │ { model, messages, thinking,     │
  │   output_config: {               │
  │     effort: "high",              │
  │     format: { ... }   ← strip   │
  │   },                             │
  │   future_field: "?"   ← passthru│
  │ }                                │
  └────────────────┬─────────────────┘
                   │ rewriteRequestBody
                   │ (only touch known-bad fields)
                   ▼
  ┌──────────────────────────────────┐
  │ same body, mostly untouched      │
  │   max_tokens default          ✓  │
  │   thinking.type=enabled→adaptive │
  │     (claude-opus-4.7 only)    ✓  │
  │   output_config.format stripped  │
  │   future_field passthru       ✓  │
  └────────────────┬─────────────────┘
                   │ filterAnthropicBeta (header blocklist)
                   ▼
              Upstream API
              (everything except explicitly stripped fields)
```

## Response `model` echo quirk

The upstream response body's `model` field is **not** the id we forwarded — Copilot canonicalizes it before echoing:

- dot form is replaced with dash (`claude-opus-4.6` → `claude-opus-4-6`)

Per CLAUDE.md (transparent proxy principle), the portal does not rewrite the echoed field.

## Reproducing

```bash
# proxy must be running locally
pnpm dev

# in another shell
cd packages/core
GITHUB_TOKEN=gho_xxx npx vitest run --project e2e tests/e2e/model-mapping.e2e.test.ts
```
