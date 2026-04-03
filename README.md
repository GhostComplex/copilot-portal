# Copilot Portal

Turn your GitHub Copilot subscription into your own API endpoint.

## Quick Start

### 1. Get OAuth Token

```bash
npx copilot-portal auth
```

This opens GitHub Device Flow — enter the code at github.com/login/device, then you'll get a token like `<your_copilot_token>`.

### 2. Deploy to Cloudflare Workers

```bash
git clone https://github.com/GhostComplex/copilot-portal
cd copilot-portal
pnpm install

# Deploy (from service directory)
cd packages/service
npx wrangler deploy
```

### 3. Use It

```bash
curl https://your-worker.workers.dev/v1/chat/completions \
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
    "ANTHROPIC_BASE_URL": "https://your-worker.workers.dev",
    "ANTHROPIC_AUTH_TOKEN": "<your_copilot_token>"
  }
}
```

### OpenAI SDK

```typescript
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://your-worker.workers.dev/v1",
  apiKey: "<your_copilot_token>",
});
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI Chat Completions format |
| `POST /v1/messages` | Anthropic Messages format |
| `GET /v1/models` | List available models |
| `GET /health` | Health check |

## How It Works

```
You run CLI → Device Flow → OAuth Token (stored locally)
                                ↓
Request with token → Service exchanges for Copilot Token (cached ~30min)
                                ↓
                        GitHub Copilot API
```

**The service is stateless** — your OAuth token stays on your machine, not on the server.

## Security

- **OAuth Token**: Stored on your machine (`~/.copilot-portal/token` if you use `--save`)
- **Minimal Scope**: Only `read:user` permission
- **Revoke Anytime**: github.com/settings/applications → Revoke "Visual Studio Code"
- **Server Storage**: None — in-memory Copilot Token cache only (cleared on restart)

## Project Structure

```
copilot-portal/
├── packages/
│   ├── service/     # CF Workers API proxy
│   └── cli/         # OAuth Device Flow CLI
└── docs/
    └── prd.md       # Product Requirements Document
```

## Contributing

### Prerequisites

- Node.js 22+
- pnpm 10+

### Development Setup

```bash
# Clone and install
git clone https://github.com/GhostComplex/copilot-portal
cd copilot-portal
pnpm install

# Build CLI
pnpm --filter copilot-portal build

# Get OAuth token (one-time)
node packages/cli/dist/index.js auth
# → Save the token somewhere

# Start service dev server
pnpm dev
# → Running at http://localhost:8787

# Test
curl http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer <your_copilot_token>" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4.5","messages":[{"role":"user","content":"hi"}]}'
```

### Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start service dev server |
| `cd packages/service && npx wrangler deploy` | Deploy to Cloudflare Workers |
| `pnpm test` | Run tests |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | Type check all packages |

### Testing CLI Locally

```bash
# Build
pnpm --filter copilot-portal build

# Run
node packages/cli/dist/index.js auth          # Get token
node packages/cli/dist/index.js auth --save   # Get and save token
node packages/cli/dist/index.js token         # Show saved token
```

## License

MIT
