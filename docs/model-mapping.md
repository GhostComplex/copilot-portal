# `/v1/messages` Model & Beta Mapping

How copilot-portal rewrites the request body and `anthropic-beta` header before forwarding to `api.githubcopilot.com`.

## Rules currently applied (in order)

Defined in `packages/core/src/routes/messages/rewrite.ts` and `packages/core/src/services/copilot.ts`.

1. **Default `max_tokens`** — inject `16384` if absent.
2. **Opus 4.7 thinking rewrite** — if `model` starts with `claude-opus-4.7` and `thinking.type === "enabled"`, rewrite to `thinking={type:"adaptive"}` + `output_config.effort="medium"`.
3. **Beta header whitelist** (`filterAnthropicBeta`) — keep only:
   - `context-management-2025-06-27`
   - `advanced-tool-use-2025-11-20`
   - `interleaved-thinking-2025-05-14` (dropped for `claude-opus-4.7*`)

   Everything else is dropped before forwarding.

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
