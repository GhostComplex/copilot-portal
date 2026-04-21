# Core

Shared API routes, Copilot proxy logic, message translation, and tests used by both runtime hosts.

## Scope

- Hono app assembly
- OpenAI-compatible and Anthropic-compatible routes
- Copilot token exchange and upstream calls
- SSE translation utilities
- Unit and integration-style tests for shared behavior

## Commands

Run from this directory with `pnpm <script>`.

| Script | Description |
|--------|-------------|
| `build` | Validate the package with TypeScript |
| `typecheck` | Run TypeScript checks |
| `lint` | Lint shared source and tests |
| `lint:fix` | Auto-fix lint issues |
| `format` | Format shared source and tests |
| `format:check` | Check formatting |
| `test` | Run the shared test suite |
| `test:watch` | Run tests in watch mode |
| `test:e2e` | Run e2e tests against upstream and proxy (requires `GITHUB_TOKEN`) |
| `test:coverage` | Generate coverage for shared tests |

## Notes

This package is not a standalone deploy target. It exists to keep host-specific packages thin.
