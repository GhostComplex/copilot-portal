# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Does

Copilot Portal turns a GitHub Copilot subscription into a standalone API endpoint. It proxies requests to GitHub Copilot's API using OAuth tokens, exposing OpenAI-compatible (`/v1/chat/completions`) and Anthropic-compatible (`/v1/messages`) endpoints. The server is stateless — tokens are passed by the client per-request.

## Monorepo Structure

pnpm 10 workspace with four packages:

- **packages/core** — Shared Hono routes, Copilot proxy logic, services. Dependency of both hosts. Only package with tests.
- **packages/node-service** — Node.js host (`@hono/node-server`). Bundled with tsup. Deployed via Docker to Azure.
- **packages/cf-workers** — Cloudflare Workers host. Deployed via wrangler.
- **packages/cli** — OAuth Device Flow CLI (`npx copilot-portal auth`). Published to npm as `copilot-portal`.

Core is a workspace dependency (`workspace:*`) consumed by node-service and cf-workers.

## Commands

| Task | Command |
|---|---|
| Install deps | `pnpm install` |
| Dev server (Node) | `pnpm dev` |
| Dev server (CF Workers) | `pnpm dev:cf` |
| Build all | `pnpm build` |
| Typecheck all | `pnpm typecheck` |
| Lint | `pnpm lint` |
| Lint fix | `pnpm lint:fix` |
| Format | `pnpm format` |
| Format check | `pnpm format:check` |
| Run all tests | `pnpm test` |
| Run single test | `cd packages/core && npx vitest run tests/foo.test.ts` |
| Watch tests | `cd packages/core && pnpm test:watch` |
| Test coverage | `pnpm test:coverage` |
| Deploy CF Workers | `pnpm deploy:cf` |

## Testing

Vitest is configured only in `packages/core`. Tests live in `packages/core/tests/**/*.test.ts`. Globals are enabled (no need to import `describe`/`it`/`expect`).

## Code Style

- Prettier: double quotes, semicolons, trailing commas (es5)
- ESLint: `@typescript-eslint` recommended, unused vars prefixed with `_` are allowed
- TypeScript: strict mode, ESNext target, Bundler moduleResolution
- Pre-commit hook runs prettier and eslint checks on staged files — it does **not** auto-fix. Run `pnpm format` and `pnpm lint:fix` before committing.

## Build

- **core**: type-check only (`tsc --noEmit`), consumed as source by hosts
- **node-service** and **cli**: bundled with `tsup`
- **cf-workers**: type-check only, bundled by wrangler at deploy time

## Deployment (Azure)

Deployments are triggered by tag pushes, not branch pushes:

- **Staging**: push a `staging-YYYYMMDD.XX` tag where XX is the deploy sequence for that day (e.g. `git tag staging-20260416.01 && git push origin staging-20260416.01`)
- **Production**: push a `release-X.Y.Z` tag (e.g. `git tag release-1.0.0 && git push origin release-1.0.0`)

Both environments build a Docker image, push it to ACR, and update the Azure Web App container config.

The pre-push hook (`.githooks/pre-push`) validates tags on push:
1. Tag must match `staging-YYYYMMDD.XX` or `release-X.Y.Z` format
2. Tag must not already exist on the remote
3. Release tag version must match the root `package.json` `version` field

## Git Conventions

- **Branch naming**: `user/<user-name>/<work-item>` (e.g. `user/steins/fix-thinking-signature`)
- **Commit/PR title prefix**: start with a type — `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `ci:` (e.g. `feat: add /v1/embeddings endpoint`)
- **Design principle**: this project is a **transparent proxy / translation layer**. Do not add logic to fix client-side bugs (e.g. malformed content blocks, orphaned tool results). Only handle translation, routing, and passthrough concerns.

## Requirements

Node.js 22+, pnpm 10+
