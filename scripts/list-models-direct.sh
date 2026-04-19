#!/usr/bin/env bash
# List all models exposed by GitHub Copilot's upstream API directly,
# bypassing copilot-portal entirely. Useful for confirming the portal's
# /v1/models is a faithful passthrough, or for debugging when a model
# id behaves differently between portal and upstream.
#
# Usage:
#   GITHUB_TOKEN=gho_xxx scripts/list-models-direct.sh
#
# Two requests:
#   1. Exchange GitHub OAuth token (gho_xxx) for a short-lived Copilot JWT
#      via https://api.github.com/copilot_internal/v2/token
#   2. GET https://api.githubcopilot.com/models with that JWT
#
# Prints one model id per line, sorted.

set -euo pipefail

: "${GITHUB_TOKEN:?set GITHUB_TOKEN to your gho_... GitHub OAuth token}"

EDITOR_VERSION="vscode/1.110.1"

TOKEN=$(curl -sSf \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/json" \
  -H "User-Agent: GitHubCopilotChat/0.38.2" \
  -H "Editor-Version: $EDITOR_VERSION" \
  -H "Editor-Plugin-Version: copilot-chat/0.38.2" \
  -H "X-GitHub-Api-Version: 2025-10-01" \
  https://api.github.com/copilot_internal/v2/token \
  | jq -r .token)

if [[ -z "$TOKEN" || "$TOKEN" == "null" ]]; then
  echo "Token exchange returned no token" >&2
  exit 1
fi

curl -sSf \
  -H "Authorization: Bearer $TOKEN" \
  -H "User-Agent: GitHubCopilotChat/0.38.2" \
  -H "Editor-Version: $EDITOR_VERSION" \
  -H "Editor-Plugin-Version: copilot-chat/0.38.2" \
  -H "Copilot-Integration-Id: vscode-chat" \
  -H "X-GitHub-Api-Version: 2025-10-01" \
  https://api.githubcopilot.com/models \
  | jq -r '.data[].id' \
  | sort
