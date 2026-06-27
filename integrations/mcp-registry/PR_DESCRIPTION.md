## Summary

Adds **NodeProxy** to the MCP registry — an x402-gated web surface parser that returns token-efficient Markdown for autonomous agents.

## Service details

| Field | Value |
|-------|-------|
| Name | `nodeproxy` |
| MCP transport | `https://nodeproxy-production.up.railway.app/mcp` |
| Tools catalog | `https://nodeproxy-production.up.railway.app/mcp/tools` |
| Well-known | `https://nodeproxy-production.up.railway.app/.well-known/mcp.json` |
| Health | `https://nodeproxy-production.up.railway.app/health` |
| GitHub | https://github.com/pgalyen1987/NodeProxy |

## Tool

- **`surface_markdown_parser`** — fetches a public URL, strips HTML noise, returns Markdown.
- Paid via **x402 v2** USDC micropayments ($0.002/parse default).

## Verification

```bash
curl -s https://nodeproxy-production.up.railway.app/health | jq .
curl -s https://nodeproxy-production.up.railway.app/mcp/tools | jq .
```

## Test plan

- [ ] Health endpoint returns `{ "ok": true }`
- [ ] `/mcp/tools` lists `surface_markdown_parser` with valid JSON schema
- [ ] MCP streamable HTTP transport responds at `/mcp`
- [ ] HTTPS certificate valid on Railway domain
