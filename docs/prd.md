# Copilot Gate PRD

> Turn your GitHub Copilot subscription into your own API endpoint.

## Overview

A **stateless** API proxy that forwards requests to GitHub Copilot. Users authenticate via OAuth Device Flow, get a token, and pass it with every request — no server-side storage.

**Two components:**
- **`@copilot-gate/service`** — Stateless API proxy (CF Workers)
- **`@copilot-gate/cli`** — CLI to obtain OAuth token via Device Flow

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        First Time Setup                      │
│                                                              │
│  $ npx copilot-gate auth                                  │
│                                                              │
│  → Visit https://github.com/login/device                    │
│  → Enter code: XXXX-XXXX                                    │
│                                                              │
│  Your OAuth Token: <your_copilot_token>                     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        Every Request                         │
│                                                              │
│  Client (Claude Code, etc.)                                 │
│    Authorization: Bearer <your_copilot_token>               │
│                              │                               │
│                              ▼                               │
│  Copilot Gate (CF Workers)                                │
│    1. OAuth Token from header                               │
│    2. Exchange for Copilot Token (cached ~30min)            │
│    3. Forward to api.githubcopilot.com                      │
│                              │                               │
│                              ▼                               │
│  GitHub Copilot API                                         │
└─────────────────────────────────────────────────────────────┘
```

## Why Device Flow?

GitHub's `/copilot_internal/v2/token` API **only accepts OAuth tokens**, not Personal Access Tokens (PAT).

| Token Type | Works with Copilot API? |
|------------|------------------------|
| Classic PAT (`ghp_xxx`) | ❌ 404 |
| Fine-grained PAT (`github_pat_xxx`) | ❌ 404 |
| OAuth Token (`ghu_xxx`) | ✅ |

The CLI uses GitHub's official Copilot OAuth App (`Iv1.b507a08c87ecfe98`) with minimal `read:user` scope.

## Core Features

### Service

| Feature | Description |
|---------|-------------|
| **Stateless** | No database, no KV. In-memory cache only. |
| **Multi-tenant** | Anyone can use with their own OAuth token |
| **OpenAI Compatible** | `/v1/chat/completions` endpoint |
| **Streaming** | Full SSE streaming support |
| **Token Caching** | In-memory Copilot token cache (~30min) |

### CLI

| Feature | Description |
|---------|-------------|
| **Device Flow** | `npx copilot-gate auth` |
| **Token Output** | Prints token to stdout |
| **Optional Save** | `--save` writes to `~/.copilot-gate/token` |

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI Chat Completions format |
| `GET /health` | Health check |

## Security

| Aspect | How It's Handled |
|--------|------------------|
| **OAuth Scope** | `read:user` only — minimal permissions |
| **Token Storage** | User's machine only |
| **Server Storage** | None — stateless, in-memory cache only |
| **Transport** | HTTPS enforced by CF Workers |
| **Revocation** | github.com/settings/applications → Revoke "Visual Studio Code" |

## Milestones

### M0: Core Service ✅

- [x] Hono app skeleton
- [x] OAuth Token → Copilot Token exchange
- [x] In-memory token cache
- [x] `/v1/chat/completions` passthrough
- [x] `/health` endpoint

### M1: Auth CLI ✅

- [x] `npx copilot-gate auth` — Device Flow
- [x] `--save` flag to persist token
- [x] `npx copilot-gate token` — show saved token
- [x] Monorepo setup (pnpm workspaces)

### M2: Anthropic Format

- [ ] `/v1/messages` endpoint
- [ ] Anthropic ↔ OpenAI message conversion
- [ ] `/v1/models` endpoint

### M3: Polish

- [ ] npm publish (`npx copilot-gate`)
- [ ] Azure Functions / Container Apps support
