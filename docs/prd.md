# Copilot Shadow PRD

> Turn your GitHub Copilot subscription into your own API endpoint

## Goal

A minimal API gateway that lets multiple machines share your GitHub Copilot subscription.

~500 lines of code. 5-minute deployment.

## Core Features

| Feature | Priority | Description |
|---------|----------|-------------|
| GitHub Token → Copilot Token | P0 | Auto-fetch, cache, refresh |
| OpenAI Chat Completions API | P0 | `/v1/chat/completions` |
| Anthropic Messages API | P0 | `/v1/messages` |
| API Key Authentication | P0 | Environment variable config |
| Model Listing | P1 | `/v1/models` |
| Multi-platform Deployment | P1 | Cloudflare Workers + Azure Functions |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Copilot Shadow                         │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Routes  │  │   Auth   │  │ Copilot  │  │ Storage  │    │
│  │          │  │          │  │  Client  │  │ Adapter  │    │
│  │ /v1/chat │  │ API Key  │  │          │  │          │    │
│  │ /v1/msg  │  │ verify   │  │ Token    │  │ CF KV    │    │
│  │ /v1/mdls │  │          │  │ fetch    │  │ Azure TB │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │           │
│  ─────┴─────────────┴─────────────┴─────────────┴─────────  │
│                         Hono App                            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    GitHub Copilot API                       │
│            https://api.githubcopilot.com                    │
└─────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
copilot-shadow/
├── src/
│   ├── app.ts             # Hono app + routes (~150 lines)
│   ├── copilot.ts         # Copilot token & request (~100 lines)
│   ├── transform.ts       # OpenAI ↔ Anthropic conversion (~150 lines)
│   └── storage/
│       ├── types.ts       # Storage interface (~20 lines)
│       ├── cloudflare.ts  # CF KV adapter (~30 lines)
│       └── azure.ts       # Azure Table Storage (~50 lines)
├── worker.ts              # CF Workers entry
├── azure/
│   └── function.ts        # Azure Functions entry
├── wrangler.toml          # CF config
├── package.json
└── README.md
```

**Estimated total lines:** ~500 (excluding config files)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | ✅ | GitHub Personal Access Token |
| `API_KEY` | ✅ | Client access key (set by you) |
| `ACCOUNT_TYPE` | ❌ | `individual` / `business` / `enterprise`, defaults to `individual` |

## API Endpoints

### `POST /v1/chat/completions`

OpenAI Chat Completions format, forwarded to Copilot.

```bash
curl https://copilot-shadow.your-domain.workers.dev/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

### `POST /v1/messages`

Anthropic Messages format, converted and forwarded to Copilot.

```bash
curl https://copilot-shadow.your-domain.workers.dev/v1/messages \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "claude-sonnet-4-20250514", "max_tokens": 1024, "messages": [{"role": "user", "content": "Hello"}]}'
```

### `GET /v1/models`

Returns available model list.

### `GET /health`

Health check.

## Technical Decisions

### 1. Framework: Hono

- Cross-platform (CF Workers, Azure Functions)
- Lightweight (~14KB)
- Web standard API

### 2. No Global State

All functions receive explicit parameters, no global variables. Easy to test and maintain.

```ts
// ✅ Good
async function fetchCopilotToken(githubToken: string, storage: Storage): Promise<string>

// ❌ Bad
async function fetchCopilotToken(): Promise<string> // implicit dependency on global state
```

### 3. Token Caching Strategy

Two-level cache:
1. **Request-level cache**: Reuse token within same request
2. **Persistent cache**: KV/Table Storage, reuse across requests

Copilot Token expires in ~30 minutes, refresh 5 minutes early.

### 4. Error Handling

- Unified error format
- Auto-retry (network errors, not 4xx)
- Exponential backoff

### 5. Streaming Response

Supports SSE streaming output, directly proxies Copilot response.

## Deployment

### Cloudflare Workers

```bash
# 1. Clone
git clone https://github.com/GhostComplex/copilot-shadow
cd copilot-shadow

# 2. Configure secrets
wrangler secret put GITHUB_TOKEN
wrangler secret put API_KEY

# 3. Deploy
wrangler deploy
```

### Azure Functions

```bash
# 1. Create Function App
az functionapp create --name copilot-shadow --runtime node

# 2. Configure environment variables
az functionapp config appsettings set --name copilot-shadow \
  --settings GITHUB_TOKEN=ghp_xxx API_KEY=your-key

# 3. Deploy
func azure functionapp publish copilot-shadow
```

## Client Configuration

### Claude Code

`.claude/settings.json`:
```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://copilot-shadow.your-domain.workers.dev",
    "ANTHROPIC_AUTH_TOKEN": "your-api-key"
  }
}
```

### OpenAI SDK

```ts
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://copilot-shadow.your-domain.workers.dev/v1',
  apiKey: 'your-api-key'
})
```

## Milestones

### M0: Core (~300 lines)

- [ ] Hono app skeleton
- [ ] API Key auth middleware
- [ ] Copilot token fetch + cache
- [ ] `/v1/chat/completions` passthrough
- [ ] `/health` endpoint
- [ ] CF Workers deployment

### M1: Anthropic + Azure (~200 lines)

- [ ] `/v1/messages` endpoint
- [ ] OpenAI ↔ Anthropic message conversion
- [ ] Azure Functions adapter
- [ ] Azure Table Storage adapter

### M2: Polish

- [ ] `/v1/models` endpoint
- [ ] Streaming response optimization
- [ ] README documentation
- [ ] Error message improvements

## Comparison with Existing Projects

| | ericc-ch/copilot-api | Menci/copilot-gateway | **copilot-shadow** |
|--|---------------------|----------------------|-------------------|
| Purpose | CLI tool + service | Full-featured gateway | Minimal gateway |
| Code size | ~3000 lines | ~1500 lines | ~500 lines |
| UI | Terminal | Web Dashboard | None |
| Multi-user | Single user | Multiple API Keys | Single API Key |
| Deployment | VM / Docker | CF / Deno | CF / Azure |
| Features | Comprehensive | Comprehensive | Minimum viable |

## Security Considerations

1. **HTTPS**: Automatically provided by platform (CF Workers / Azure Functions)
2. **API Key**: Stored in environment variables, not in code
3. **GitHub Token**: Stored in environment variables, only used to obtain Copilot Token
4. **No Logging**: Request content is not logged
5. **No User Data Persistence**: Only caches Copilot Token

## Future Possibilities (Out of Scope)

- Multiple GitHub Token rotation
- Simple usage statistics (request counting)
- Rate limiting
- AWS Lambda support
