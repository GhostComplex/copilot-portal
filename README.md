# copilot-gate

Secure reverse proxy for [copilot-api](https://github.com/ericc-ch/copilot-api) with GitHub OAuth authentication.

## Why?

When using `copilot-api` across multiple machines, each machine would need to run its own instance. This causes:
- Multiple IP addresses accessing GitHub Copilot → potential abuse detection
- Token management headaches on each machine

**copilot-gate** solves this by:
1. Running `copilot-api` on a single VM with a stable IP
2. Adding an authentication layer using GitHub tokens
3. Allowing your other machines to connect through this proxy

```
[MacBook] ──┐
            ├── (GitHub PAT auth) ──> [copilot-gate :4141] ──> [copilot-api :4142] ──> GitHub Copilot
[HomeLab] ──┘
```

## Quick Start

### Option 1: Docker Compose (Recommended)

```bash
# Clone the repo
git clone https://github.com/GhostComplex/copilot-gate.git
cd copilot-gate

# Configure
cp .env.example .env
# Edit .env with your settings

# Start both copilot-api and copilot-gate
docker compose up -d
```

### Option 2: npx (Development)

```bash
# Terminal 1: Start copilot-api
npx copilot-api@latest start --port 4142

# Terminal 2: Start copilot-gate
cd copilot-gate
bun run start
# Or with explicit user:
bun run start --allowed-user your-github-username
```

## Client Configuration

On your client machines, configure your OpenAI/Anthropic-compatible tools:

### Claude Code

Create `.claude/settings.json`:

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "ghp_YOUR_GITHUB_PAT",
    "ANTHROPIC_BASE_URL": "https://your-vm-address:4141",
    "ANTHROPIC_MODEL": "claude-sonnet-4-20250514"
  }
}
```

### OpenAI SDK

```python
import openai

client = openai.OpenAI(
    api_key="ghp_YOUR_GITHUB_PAT",  # Your GitHub PAT
    base_url="https://your-vm-address:4141/v1"
)
```

### curl

```bash
curl https://your-vm-address:4141/v1/chat/completions \
  -H "Authorization: Bearer ghp_YOUR_GITHUB_PAT" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}]}'
```

## Authentication

copilot-gate uses GitHub tokens (PAT or `gh auth token`) for authentication:

1. **Server side**: Configure `ALLOWED_USER` to specify which GitHub user is allowed
2. **Client side**: Send your GitHub token in the `Authorization: Bearer <token>` header

The server validates the token by calling GitHub API (`/user`) and checking if the username matches.

### Getting a Token

**Option A: Use `gh` CLI (easiest)**
```bash
gh auth login
gh auth token  # Copy this output
```

**Option B: Create a PAT (more secure)**
1. Go to https://github.com/settings/tokens?type=beta
2. Generate new token (fine-grained)
3. Set permissions: Account permissions → Read-only access to your profile
4. Copy the token

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `4141` | Port to listen on |
| `UPSTREAM` | `http://localhost:4142` | Upstream copilot-api URL |
| `ALLOWED_USER` | (auto-detect) | GitHub username allowed to access |
| `CACHE_TTL_MS` | `300000` | Token cache TTL (5 minutes) |
| `VERBOSE` | `false` | Enable verbose logging |

### CLI Arguments

```
copilot-gate [OPTIONS]

OPTIONS:
  -p, --port <PORT>           Port to listen on
  -u, --upstream <URL>        Upstream copilot-api URL
      --allowed-user <USER>   GitHub username to allow
  -v, --verbose               Enable verbose logging
  -h, --help                  Show help message
```

## Security

- **Token validation**: Every request is validated against GitHub API (with caching)
- **Token isolation**: Client tokens are NOT passed to upstream; copilot-api uses its own token
- **Minimal permissions**: Clients only need `read:user` scope (if using fine-grained PAT)
- **No persistence**: Tokens are only cached in memory

## Architecture

```
Client Request
     │
     │ Authorization: Bearer ghp_xxx (client's GitHub token)
     ▼
┌─────────────────────────────────────────────────────────────┐
│ copilot-gate                                                │
│                                                             │
│  1. Extract token from Authorization header                 │
│  2. Call GitHub API to verify token belongs to allowed user │
│  3. If valid, proxy request to upstream (without token)     │
└─────────────────────────────────────────────────────────────┘
     │
     │ (no Authorization header)
     ▼
┌─────────────────────────────────────────────────────────────┐
│ copilot-api                                                 │
│                                                             │
│  Uses its own GitHub token (from GH_TOKEN env var)          │
│  to authenticate with GitHub Copilot                        │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
GitHub Copilot API
```

## License

MIT
