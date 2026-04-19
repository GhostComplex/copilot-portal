# `/v1/messages` Model & Beta Mapping

How copilot-portal rewrites the `model` field and `anthropic-beta` header before forwarding to `api.githubcopilot.com`.

> **Snapshot:** results below verified against upstream on **2026-04-19**.
> If a row's "Result" column changes (e.g. a 404 starts succeeding), upstream
> has either added a new model id or changed its naming rules — update this
> doc and `packages/core/tests/e2e/model-mapping.e2e.test.ts` together.

## Rules currently applied (in order)

Defined in `packages/core/src/routes/messages/rewrite.ts` and `packages/core/src/services/copilot.ts`.

1. **Variant suffix append** (`resolveModelVariant`)
   - If `anthropic-beta` contains a token starting with `context-1m-` → append `-1m` to `model`.
   - If it contains a token starting with `fast-mode-` → append `-fast` to `model`.
   - **No catalog awareness** — applied to any model.
2. **Default `max_tokens`** — inject `16384` if absent.
3. **Opus 4.7 thinking rewrite** — if `model` starts with `claude-opus-4.7` and `thinking.type === "enabled"`, rewrite to `thinking={type:"adaptive"}` + `output_config.effort="medium"`. Match is case- and form-sensitive (`startsWith("claude-opus-4.7")`).
4. **Beta header whitelist** (`filterAnthropicBeta`) — keep only:
   - `context-management-2025-06-27`
   - `advanced-tool-use-2025-11-20`
   - `interleaved-thinking-2025-05-14` (dropped for `claude-opus-4.7*`)
   
   Everything else (including `context-1m-*` and `fast-mode-*`) is dropped before forwarding.

## Upstream catalog (Claude family, 2026-04-19)

Only models actually present at `api.githubcopilot.com/models`:

- `claude-opus-4.7`
- `claude-opus-4.6`
- `claude-opus-4.6-1m`  ← **the only `-1m` variant**
- `claude-sonnet-4.5`
- `claude-sonnet-4`
- `claude-3.7-sonnet`, `claude-3.7-sonnet-thought`, `claude-3.5-sonnet`

No `-fast` variants exist anywhere in the catalog.

## Mapping table (snapshot 2026-04-19)

| Client `model` | Client `anthropic-beta` | Forwarded `model` | Forwarded beta | Upstream |
|---|---|---|---|---|
| `claude-opus-4.6` | — | `claude-opus-4.6` | — | ✅ 200 |
| `claude-opus-4.7` | — | `claude-opus-4.7` | — | ✅ 200 |
| `claude-opus-4.6` | `context-1m-2025-08-07` | `claude-opus-4.6-1m` | (dropped) | ✅ 200 |
| `claude-opus-4-6` (dash) | `context-1m-2025-08-07` | `claude-opus-4-6-1m` | (dropped) | ❌ 4xx — **Bug 1** |
| `claude-opus-4-6-20250514` (dated) | `context-1m-2025-08-07` | `claude-opus-4-6-20250514-1m` | (dropped) | ❌ 4xx — **Bug 1** |
| `claude-opus-4.7` | `context-1m-2025-08-07` | `claude-opus-4.7-1m` | (dropped) | ❌ 4xx — **Bug 2** |
| `claude-sonnet-4.5` | `context-1m-2025-08-07` | `claude-sonnet-4.5-1m` | (dropped) | ❌ 4xx — **Bug 2** |
| any | `fast-mode-anything` | `<model>-fast` | (dropped) | ❌ 4xx — **Bug 3** |
| `claude-opus-4.6` | `context-management-2025-06-27` | `claude-opus-4.6` | `context-management-2025-06-27` | ✅ 200 |
| `claude-opus-4.7` | `interleaved-thinking-2025-05-14` | `claude-opus-4.7` | (dropped, 4.7 rejects it) | ✅ 200 |
| `claude-opus-4-7` (dash) | `interleaved-thinking-2025-05-14` | `claude-opus-4-7` | `interleaved-thinking-...` (leaked) | ❌ — **Bug 4** |

## Known bugs

- **Bug 1 — dash/dot mismatch.** Claude Code sends model in dash form (`claude-opus-4-6`, possibly with date suffix). Appending `-1m` produces an id that doesn't exist upstream. **Today, the only path that reaches `claude-opus-4.6-1m` is dot-form clients.**
- **Bug 2 — blanket suffix.** `-1m` is appended to every model when the beta is present, but only `claude-opus-4.6` has a `-1m` variant. All other models 404.
- **Bug 3 — dead `-fast` branch.** No `-fast` variants exist; the rule guarantees a 404 whenever it fires.
- **Bug 4 — `startsWith("claude-opus-4.7")` blind to dash/date forms.** Both `rewriteOpus47Thinking` and `filterAnthropicBeta` miss `claude-opus-4-7` and `claude-opus-4-7-20250514`, so the thinking rewrite is skipped and `interleaved-thinking-*` is forwarded to a model that rejects it.

## Response `model` echo quirk

The upstream response body's `model` field is **not** the id we forwarded — Copilot canonicalizes it before echoing:

- dot form is replaced with dash (`claude-opus-4.6` → `claude-opus-4-6`)
- variant suffix is stripped (`claude-opus-4.6-1m` → `claude-opus-4-6`, with `-1m` dropped)

Verified 2026-04-19: posting `claude-opus-4.6` and `claude-opus-4.6-1m` both echo back `claude-opus-4-6`.

Implications:

1. **Cannot infer 1M activation from `response.model`.** The echoed id is identical with or without the `-1m` variant. Confirm 1M by token-usage limits or by sending a >200k-token prompt.
2. **Round-trip footgun.** Feeding `response.model` straight back into the next request body will 4xx — input accepts dot form only, but echo is dash. Clients should keep their own canonical model id rather than copying from the response.

Per CLAUDE.md (transparent proxy principle), the portal does not rewrite the echoed field.

## Reproducing

```bash
# proxy must be running locally
pnpm dev

# in another shell
cd packages/core
GITHUB_TOKEN=gho_xxx npx vitest run --project e2e tests/e2e/model-mapping.e2e.test.ts
```

Direct upstream catalog (bypasses the proxy entirely):

```bash
GITHUB_TOKEN=gho_xxx scripts/list-models-direct.sh
```
