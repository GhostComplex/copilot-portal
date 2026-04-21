# Copilot Portal

Turn your GitHub Copilot subscription into your own API endpoint.

## Quick Start

### 1. Get OAuth Token

```bash
npx copilot-portal auth
```

This opens GitHub Device Flow — enter the code at github.com/login/device, then you'll get a token like `<your_copilot_token>`.

### 2. Deploy

#### Option A. Cloudflare Workers

```bash
git clone https://github.com/GhostComplex/copilot-portal
cd copilot-portal
pnpm install

# Deploy Cloudflare Workers
pnpm deploy:cf
```

#### Option B. Azure Web App (Docker)

Use the included `Dockerfile` with Azure Web App for Containers. The smoothest setup is:

1. Create a Linux Web App and an Azure Container Registry.
2. Configure the Web App health check path as `/health`.
3. Add the required GitHub repository secrets.
4. Push a deploy tag — `staging-YYYYMMDD.XX` triggers `deploy-staging.yml`, `release-X.Y.Z` triggers `deploy-production.yml`.

Required GitHub secrets:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`
- `AZURE_RESOURCE_GROUP`
- `AZURE_WEBAPP_NAME`
- `ACR_LOGIN_SERVER`
- `ACR_USERNAME`
- `ACR_PASSWORD`

The workflow builds the image from the repository root, pushes it to ACR, and updates the Web App container image. See [CLAUDE.md](CLAUDE.md#deployment-azure) for tag format details.

### 3. Test It

Replace `YOUR_BASE_URL` with your deployed service URL, for example:

- `https://your-worker.workers.dev`
- `https://your-app.azurewebsites.net`
- `https://api.yourdomain.com`

```bash
curl YOUR_BASE_URL/v1/chat/completions \
  -H "Authorization: Bearer <your_copilot_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4.5","messages":[{"role":"user","content":"Hello!"}]}'
```

## Client Setup

### Claude Code

Create `.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "YOUR_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN": "<your_copilot_token>"
  }
}
```

### OpenAI SDK

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "YOUR_BASE_URL/v1",
  apiKey: "<your_copilot_token>",
});
```

## API Endpoints

All endpoints are relative to `YOUR_BASE_URL`.

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI Chat Completions format |
| `POST /v1/messages` | Anthropic Messages format |
| `POST /v1/responses` | OpenAI Responses API passthrough |
| `GET /v1/models` | List available models |
| `GET /health` | Health check |

## How It Works

```
You run CLI → Device Flow → OAuth Token (stored locally)
                                ↓
Request with token → Service exchanges for Copilot Token (cached until expiry)
                                ↓
                        GitHub Copilot API
```

**The service is stateless** — your OAuth token stays on your machine, not on the server.

## Request translation (`/v1/messages`)

The proxy is a transparent layer: unknown fields pass through untouched, only known-bad fields are stripped or rewritten. This keeps the proxy auto-compatible with future upstream features. Logic lives in `packages/core/src/routes/messages/translate.ts`.

| Where | Field | Trigger | Action | Why |
|---|---|---|---|---|
| body | `max_tokens` | absent | inject `16384` | upstream requires it |
| body | `thinking.type` | model starts with `claude-opus-4.7` and value is `enabled` | rewrite to `adaptive` | 4.7 rejects `enabled` |
| body | `thinking.budget_tokens` | model starts with `claude-opus-4.7` and `thinking.type` is `enabled` | drop | `adaptive` mode rejects this field |
| body | `output_config.format` | present | drop (and drop the whole `output_config` if empty) | upstream rejects Structured Outputs with 400; some SDKs auto-inject this |
| body | `output_config.effort` | always | leave as-is | client-controlled |
| header | `anthropic-beta: context-1m-2025-08-07` | present in list | drop from comma-separated value | upstream rejects this beta |
| header | other `anthropic-beta` values | always | forward as-is | unknown betas pass through |

### Response `model` echo quirk

The upstream response body's `model` field is **not** the id we forwarded — Copilot canonicalizes it before echoing (e.g. `claude-opus-4.6` → `claude-opus-4-6`). Per the transparent proxy principle, the portal does not rewrite the echoed field.

## Security

- **OAuth Token**: Stored on your machine (`~/.copilot-portal/token` if you use `--save`)
- **Minimal Scope**: Only `read:user` permission
- **Revoke Anytime**: github.com/settings/applications → Revoke "Visual Studio Code"
- **Server Storage**: None — in-memory Copilot Token cache only (cleared on restart)

## Project Structure

```
copilot-portal/
├── packages/
│   ├── core/         # Shared API routes, Copilot proxy, translation logic
│   ├── cf-workers/   # Cloudflare Workers host
│   ├── node-service/ # Node.js host for Azure/App Service
│   └── cli/          # OAuth Device Flow CLI
```

## Development

### Workspace Setup

- Node.js 22+
- pnpm 10+

```bash
git clone https://github.com/GhostComplex/copilot-portal
cd copilot-portal
pnpm install
pnpm build
```

### Workspace Commands

| Command | Description |
|---------|-------------|
| `pnpm build` | Build all workspace packages |
| `pnpm lint` | Lint all packages |
| `pnpm format:check` | Check formatting across packages |
| `pnpm typecheck` | Type check all packages |
| `pnpm test` | Run tests for packages that expose them |
| `pnpm test:e2e` | Run e2e tests against the upstream and proxy (requires `GITHUB_TOKEN`) |
| `pnpm test:coverage` | Run coverage for packages that expose it |
| `pnpm dev` | Start Node service dev server |
| `pnpm dev:cf` | Start Cloudflare Workers dev server |
| `pnpm deploy:cf` | Deploy to Cloudflare Workers |

### Run CLI from local

```bash
cd packages/cli
node dist/index.js --help
```

### Publish CLI to npm

The npm package published from this repo is the CLI package in `packages/cli`.

1. Log in to npm:

```bash
npm login
```

2. Build the CLI package from the workspace root:

```bash
pnpm --filter copilot-portal build
```

3. Optionally inspect the publish contents:

```bash
cd packages/cli
npm pack --dry-run
```

4. Publish the package:

```bash
cd packages/cli
npm publish
```

If npm rejects the publish because the version already exists, bump the version in `packages/cli/package.json` and publish again.

### Package Docs

- [packages/cli/README.md](packages/cli/README.md): npm package usage
- [packages/core/README.md](packages/core/README.md): shared routes, tests, and translation logic
- [packages/cf-workers/README.md](packages/cf-workers/README.md): Cloudflare Workers runtime and deployment
- [packages/node-service/README.md](packages/node-service/README.md): Node runtime, Docker, and Azure Web App notes

## License

MIT
