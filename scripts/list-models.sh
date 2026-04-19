#!/usr/bin/env bash
# List all Claude/Copilot models exposed by a copilot-portal deployment.
#
# Usage:
#   GITHUB_TOKEN=gho_xxx scripts/list-models.sh                # default: staging
#   GITHUB_TOKEN=gho_xxx BASE=http://localhost:3000 scripts/list-models.sh
#   GITHUB_TOKEN=gho_xxx BASE=https://your-prod-host scripts/list-models.sh
#
# Prints one model id per line, sorted. Requires `jq` and a valid GitHub
# OAuth token with Copilot access (the same `gho_xxx` you'd give Claude
# Code as ANTHROPIC_API_KEY).

set -euo pipefail

BASE="${BASE:-https://copilot-portal-staging.azurewebsites.net}"
: "${GITHUB_TOKEN:?set GITHUB_TOKEN to your gho_... GitHub OAuth token}"

curl -sSf -H "Authorization: Bearer $GITHUB_TOKEN" "$BASE/v1/models" \
  | jq -r '.data[].id' \
  | sort
