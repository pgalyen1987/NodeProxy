## Summary

Adds **NodeProxy** v1.1.0 to the MCP registry — an x402-gated web surface parser with standard and stealth anti-bot tiers.

## Service details

| Field | Value |
|-------|-------|
| Name | `nodeproxy` |
| MCP transport | `https://nodeproxy-production.up.railway.app/mcp` |
| Tools catalog | `https://nodeproxy-production.up.railway.app/mcp/tools` |
| Well-known MCP | `https://nodeproxy-production.up.railway.app/.well-known/mcp.json` |
| Well-known x402 | `https://nodeproxy-production.up.railway.app/.well-known/x402.json` |
| Health | `https://nodeproxy-production.up.railway.app/health` |
| GitHub | https://github.com/pgalyen1987/NodeProxy |

## Tools

| Tool | Endpoint | Payment |
|------|----------|---------|
| `surface_markdown_parser` | `/mcp/execute` | x402 USDC ($0.002) or Stripe MPP ($0.50) |
| `stealth_markdown_parser` | `/stealth-scrape` | x402 USDC ($0.05) |

Both tools include x402 Bazaar discovery extension metadata on 402 responses.

## Verification

```bash
curl -s https://nodeproxy-production.up.railway.app/health | jq .
curl -s https://nodeproxy-production.up.railway.app/mcp/tools | jq .
curl -s https://nodeproxy-production.up.railway.app/.well-known/x402.json | jq '.resources[].toolName'
```

## Test plan

- [ ] Health endpoint returns `{ "ok": true }` with both pricing tiers
- [ ] `/mcp/tools` lists `surface_markdown_parser` and `stealth_markdown_parser`
- [ ] MCP streamable HTTP transport responds at `/mcp`
- [ ] `/.well-known/x402.json` lists both resources with Bazaar discovery enabled
- [ ] HTTPS certificate valid on Railway domain
