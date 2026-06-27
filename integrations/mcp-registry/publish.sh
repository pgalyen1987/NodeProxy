#!/usr/bin/env bash
# Publish NodeProxy to the official MCP Registry (remote HTTP + PyPI client).
# Requires: mcp-publisher login github (one-time, interactive)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! command -v mcp-publisher >/dev/null; then
  echo "Install mcp-publisher: see integrations/UPSTREAM.md"
  exit 1
fi

mcp-publisher validate server.json
echo "Run: mcp-publisher login github"
echo "Then: mcp-publisher publish"
mcp-publisher publish

echo "Search: curl 'https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.pgalyen1987/nodeproxy'"
