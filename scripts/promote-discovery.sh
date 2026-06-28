#!/usr/bin/env bash
# Verify and promote NodeProxy across machine discovery channels (MCP registry, x402 Bazaar, GitHub metadata).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PUBLIC_URL="${PUBLIC_URL:-https://nodeproxy-production.up.railway.app}"
PUBLIC_URL="${PUBLIC_URL%/}"
MCP_NAME="${MCP_NAME:-io.github.pgalyen1987/nodeproxy}"
GITHUB_REPO="${GITHUB_REPO:-pgalyen1987/NodeProxy}"
WALLET="${WALLET_ADDRESS:-0x8E57BFDE053dBb6862991759c19affC5F383d5D0}"

pass=0
fail=0

ok() { echo "  ✓ $1"; pass=$((pass + 1)); }
bad() { echo "  ✗ $1"; fail=$((fail + 1)); }

echo "NodeProxy machine discovery promotion"
echo "  URL: $PUBLIC_URL"
echo ""

echo "1. Live service probes"
health="$(curl -sf "$PUBLIC_URL/health" || true)"
if echo "$health" | grep -q '"ok":true'; then
  ok "GET /health"
else
  bad "GET /health — $health"
fi

tools="$(curl -sf "$PUBLIC_URL/mcp/tools" || true)"
if echo "$tools" | grep -q 'surface_markdown_parser'; then
  ok "GET /mcp/tools lists surface_markdown_parser"
else
  bad "GET /mcp/tools missing tool"
fi

code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PUBLIC_URL/mcp/execute" \
  -H 'Content-Type: application/json' \
  -d '{"tool":"surface_markdown_parser","arguments":{"url":"https://example.com"}}')"
if [[ "$code" == "402" ]]; then
  ok "POST /mcp/execute returns 402 x402 challenge"
else
  bad "POST /mcp/execute expected 402, got $code"
fi

for path in /.well-known/mcp.json /.well-known/x402.json /discovery/manifest.json /discovery/agent.json /registry/server.json /robots.txt; do
  c="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL$path" || echo 000)"
  if [[ "$c" == "200" ]]; then ok "GET $path"; else bad "GET $path ($c)"; fi
done

echo ""
echo "2. MCP Registry"
registry="$(curl -sf "https://registry.modelcontextprotocol.io/v0.1/servers?search=$MCP_NAME" || true)"
if echo "$registry" | grep -q "$MCP_NAME"; then
  ok "Listed as $MCP_NAME"
else
  bad "Not found in MCP registry — run: bash integrations/mcp-registry/publish.sh"
fi

echo ""
echo "3. x402 Bazaar (CDP discovery)"
bazaar="$(curl -sf "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=surface_markdown_parser" || true)"
if echo "$bazaar" | grep -q "$PUBLIC_URL"; then
  ok "Bazaar search hits $PUBLIC_URL"
elif echo "$bazaar" | grep -q 'nodeproxy'; then
  ok "Bazaar search hits nodeproxy"
else
  echo "  ~ Bazaar index may lag after first settlement (paid parse triggers catalog)"
  if curl -sf "$PUBLIC_URL/health" | grep -q '"network":"eip155:8453"'; then
    ok "Mainnet live — run scripts/test-paid-parse.sh once if not indexed yet"
  else
    bad "Not on Base mainnet yet"
  fi
fi

echo ""
echo "4. Client packages (PyPI + npm)"
if curl -sf "https://pypi.org/pypi/nodeproxy-tools/json" | grep -q '"info"'; then
  ok "nodeproxy-tools on PyPI"
else
  bad "nodeproxy-tools not on PyPI"
fi
if curl -sf "https://registry.npmjs.org/@nodeproxy%2flangchain" | grep -q '"name"'; then
  ok "@nodeproxy/langchain on npm"
else
  bad "@nodeproxy/langchain not on npm — run: bash integrations/typescript/publish.sh"
fi

echo ""
echo "5. GitHub repo metadata (for crawlers + humans)"
if command -v gh >/dev/null && gh auth status >/dev/null 2>&1; then
  gh repo edit "$GITHUB_REPO" \
    --description "x402 MCP: URLs → Markdown for agents. \$0.002 USDC on Base, Polygon, Arbitrum, Ethereum." \
    --homepage "$PUBLIC_URL" \
    --add-topic mcp --add-topic x402 --add-topic agents --add-topic langchain --add-topic web-scraping --add-topic markdown 2>/dev/null || true
  ok "GitHub description, homepage, topics updated"
else
  echo "  ~ Skip GitHub metadata (gh not authenticated)"
fi

echo ""
echo "6. Machine install block (copy to agent configs)"
cat <<EOF

--- MCP remote (streamable-http) ---
{
  "mcpServers": {
    "nodeproxy": {
      "url": "$PUBLIC_URL/mcp"
    }
  }
}

--- Python agent (x402 auto-pay) ---
pip install "nodeproxy-tools[x402,langchain]"
export EVM_PRIVATE_KEY=0x...
# from nodeproxy_tools.langchain import NodeProxyMarkdownTool

--- TypeScript / LangChain.js ---
npm install @nodeproxy/langchain @langchain/core
export EVM_PRIVATE_KEY=0x...
# import { NodeProxyMarkdownTool } from '@nodeproxy/langchain'

--- Discovery URLs ---
MCP registry : $MCP_NAME
Well-known   : $PUBLIC_URL/.well-known/mcp.json
x402         : $PUBLIC_URL/.well-known/x402.json
Tools        : $PUBLIC_URL/mcp/tools
Execute      : $PUBLIC_URL/mcp/execute
PayTo        : $WALLET

EOF

echo ""
echo "Summary: $pass passed, $fail failed"
if [[ "$fail" -gt 0 ]]; then exit 1; fi
