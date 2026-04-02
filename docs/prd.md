# Copilot Shadow PRD

> Turn your GitHub Copilot subscription into your own API endpoint.

## Overview

A stateless API proxy that forwards requests to GitHub Copilot. Each user brings their own GitHub Token — no registration, no storage, no dashboard.

**~300 lines of code. 5-minute deployment.**

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     Your Computer                           │
│                                                             │
│  .claude/settings.json:                                     │
│  {                                                          │
│    "ANTHROPIC_BASE_URL": "https://your-domain.com",        │
│    "ANTHROPIC_AUTH_TOKEN": "<your-github-token>"           │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ POST /v1/messages
                              │ Authorization: Bearer <github-token>
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     Copilot Shadow                          │
│                                                             │
│  1. Extract GitHub Token from Authorization header          │
│  2. Exchange for Copilot Token (in-memory cache, ~30min)   │
│  3. Forward request to api.githubcopilot.com               │
│  4. Stream response back                                    │
│                                                             │
│  No persistent storage. In-memory cache only.              │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              https://api.githubcopilot.com                  │
└─────────────────────────────────────────────────────────────┘
```

## Core Features

| Feature | Description |
|---------|-------------|
| **Stateless** | No database, no KV. In-memory cache only (not persisted). |
| **Multi-tenant** | Anyone can use with their own GitHub Token & Copilot subscription. |
| **Zero Config** | No API keys to generate, no registration, no dashboard. |
| **OpenAI Compatible** | `/v1/chat/completions` endpoint |
| **Anthropic Compatible** | `/v1/messages` endpoint |
| **Streaming** | Full SSE streaming support |
| **Token Caching** | In-memory Copilot token cache (~30min), reduces latency |

## API Endpoints

### `POST /v1/chat/completions`

OpenAI Chat Completions format.

```bash
curl https://your-domain.com/v1/chat/completions \
  -H "Authorization: Bearer <github-token>" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

### `POST /v1/messages`

Anthropic Messages format.

```bash
curl https://your-domain.com/v1/messages \
  -H "Authorization: Bearer <github-token>" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-20250514", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}]}'
```

### `GET /v1/models`

Returns available models.

### `GET /health`

Health check.

## Directory Structure

```
copilot-shadow/
├── src/
│   ├── app.ts             # Hono app + routes (~100 lines)
│   ├── copilot.ts         # Token exchange + forwarding (~100 lines)
│   └── transform.ts       # Anthropic ↔ OpenAI conversion (~100 lines)
├── worker.ts              # CF Workers entry
├── wrangler.toml
├── package.json
└── README.md
```

**Total: ~300 lines** (excluding config)

## Security

| Aspect | How It's Handled |
|--------|------------------|
| **Transport** | HTTPS enforced by CF Workers |
| **Token Storage** | In-memory only, cleared on worker recycle |
| **Token in Logs** | Never logged |
| **Revocation** | User revokes directly on GitHub |
| **Blast Radius** | Token leak affects only that user |

## Deployment

### Cloudflare Workers (Recommended)

```bash
git clone https://github.com/GhostComplex/copilot-shadow
cd copilot-shadow
wrangler deploy
```

No secrets to configure. That's it.

### Azure Functions

```bash
func azure functionapp publish copilot-shadow
```

## Client Setup

### Claude Code

Create `.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://copilot-shadow.your-domain.workers.dev",
    "ANTHROPIC_AUTH_TOKEN": "<your-github-token>"
  }
}
```

### Getting a GitHub Token

Two options:

**Option 1: Device Flow (Recommended — minimal permissions)**

```bash
npx copilot-shadow auth
# Opens browser, you authorize, get token with only read:user scope
```

**Option 2: GitHub Settings**

1. Go to https://github.com/settings/tokens
2. Generate new token (classic)
3. No special scopes needed if you have Copilot subscription

## Milestones

### M0: Core (~200 lines)

- [ ] Hono app skeleton
- [ ] GitHub Token → Copilot Token exchange (with in-memory cache)
- [ ] `/v1/chat/completions` passthrough
- [ ] `/health` endpoint
- [ ] CF Workers deployment

### M1: Anthropic + Models (~100 lines)

- [ ] `/v1/messages` endpoint
- [ ] Anthropic ↔ OpenAI message conversion
- [ ] `/v1/models` endpoint
- [ ] Streaming optimization

### M2: Polish

- [ ] `npx copilot-shadow auth` CLI helper
- [ ] README documentation
- [ ] Error messages

## Why This Design?

| Design Choice | Reason |
|---------------|--------|
| **No storage** | Simpler, more secure, no database to breach |
| **Token pass-through** | Users control their own tokens |
| **No dashboard** | Nothing to manage |
| **Stateless** | Scales infinitely, no cold start issues |
| **Multi-tenant by default** | Anyone can use with their own subscription |
