# NodeProxy

**Self-discoverable MCP utility for autonomous agents** — no ads, no landing page, no human in the loop.

NodeProxy exposes two paid tools:

| Tool | Endpoint | Price | Use case |
|------|----------|-------|----------|
| `surface_markdown_parser` | `POST /mcp/execute` | $0.002 USDC | Normal public pages |
| `stealth_markdown_parser` | `POST /stealth-scrape` | $0.05 USDC | Cloudflare/Akamai-protected sites |

Both fetch a public URL, strip scripts/ads/nav noise, and return compressed Markdown optimized for LLM context windows. Standard tier also accepts **Stripe MPP** card payments ($0.50 minimum) alongside x402 USDC.

Agents find this service through **MCP registries**, **x402 Bazaar discovery**, and machine-readable manifests — not marketing.

## Why agents need this

Heavy React/Vue sites burn tokens when agents ingest raw HTML. NodeProxy returns clean Markdown so autonomous retrieval loops stay cheap and accurate. When basic fetch hits bot walls, the stealth tier escalates with proxy rotation, hardened Playwright, and optional CAPTCHA solving.

## Architecture

```
Autonomous Agent
    │  search MCP registry / Bazaar (vector or keyword)
    ▼
GET /mcp/tools  or  MCP list_tools
    │  reads JSON schema ("Machine UI")
    ▼
POST /mcp/execute  or  POST /stealth-scrape
    │  no payment → 402 + PAYMENT-REQUIRED (+ Bazaar extension)
    │  x402 PAYMENT-SIGNATURE or MPP Authorization: Payment …
    │  facilitator verify/settle → parse URL
    ▼
Markdown payload → agent continues task
```

## Quick start

```bash
cd NodeProxy
cp .env.example .env
# Set WALLET_ADDRESS to your Base wallet
npm install
npm run dev
```

Endpoints (replace host with your deploy URL):

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Service status, pricing, stealth/MPP config |
| `GET /mcp/tools` | Tool catalog for registry crawlers |
| `POST /mcp/execute` | Standard parse + x402/MPP gate |
| `POST /stealth-scrape` | Stealth parse + x402 gate |
| `ALL /mcp` | Streamable HTTP MCP transport |
| `GET /.well-known/mcp.json` | Well-known MCP discovery |
| `GET /.well-known/x402.json` | x402 + Bazaar discovery manifest |
| `GET /.well-known/mpp.json` | MPP Stripe manifest (when configured) |
| `GET /discovery/agent.json` | Agent discovery card |
| `GET /registry/server.json` | Live registry manifest (dynamic) |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `WALLET_ADDRESS` | — | USDC recipient (your revenue) |
| `PRICE_USDC` | `0.002` | Standard tier price per parse |
| `STEALTH_PRICE_USDC` | `0.05` | Stealth tier price per parse |
| `X402_NETWORK` | `eip155:84532` | Primary network; use `eip155:8453` on mainnet |
| `X402_NETWORKS` | CDP bundle | Comma-separated CAIP-2 ids (Base, Polygon, Arbitrum, optional Ethereum L1) |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | x402 facilitator |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | — | Coinbase CDP facilitator (mainnet) |
| `MPP_SECRET_KEY` / `STRIPE_SECRET_KEY` | — | Stripe MPP on `/mcp/execute` |
| `STEALTH_PROXY_URLS` | — | Comma-separated proxy URLs for stealth tier |
| `CAPTCHA_SOLVER_KEY` | — | 2captcha API key (optional) |
| `PUBLIC_URL` | localhost | Used in discovery manifests |

## Machine discovery (zero advertising)

1. **Deploy** to Railway or any HTTPS host.
2. **Verify** live manifests: `/mcp/tools`, `/.well-known/x402.json`, `/registry/server.json`.
3. **Submit PR** to the [open-source MCP Registry](https://github.com/modelcontextprotocol/registry) using `integrations/mcp-registry/server-entry.json`.
4. **Bazaar auto-index**: after successful x402 settlements through a Bazaar-enabled facilitator, tools appear in the global Bazaar index ([Bazaar docs](https://docs.x402.org/extensions/bazaar)). NodeProxy attaches Bazaar extension metadata on every 402 response.
5. **Enterprise hubs** (Google Agent Registry, Anthropic routing): point them at `/.well-known/mcp.json` or `/discovery/agent.json`.

Tool descriptions are written for **LLM tool-matching**, not humans.

## Payment rails

| Rail | Tools | Destination | Amount |
|------|-------|-------------|--------|
| **x402 USDC** | Standard + stealth | Your `WALLET_ADDRESS` | $0.002 / $0.05 |
| **Stripe MPP** | Standard only | Stripe account balance | $0.50/card (SPT minimum) |

## MCP stdio (Claude Desktop / local agents)

```bash
npm run mcp:stdio
```

Add to Claude Desktop config:

```json
{
  "mcpServers": {
    "nodeproxy": {
      "command": "node",
      "args": ["--import", "tsx", "/path/to/NodeProxy/src/mcp/stdio.ts"],
      "env": { "WALLET_ADDRESS": "0x..." }
    }
  }
}
```

## HTTP execute example

```bash
# Stage A — get 402 challenge (includes Bazaar extension in PAYMENT-REQUIRED)
curl -i "http://localhost:4022/mcp/execute" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"url":"https://example.com"}}'

# Stage B — retry with PAYMENT-SIGNATURE from x402 client wallet
curl "http://localhost:4022/mcp/execute" \
  -H 'Content-Type: application/json' \
  -H 'PAYMENT-SIGNATURE: <base64>' \
  -d '{"arguments":{"url":"https://example.com"}}'

# Stealth tier (x402 only)
curl -i "http://localhost:4022/stealth-scrape" \
  -H 'Content-Type: application/json' \
  -d '{"arguments":{"url":"https://example.com"}}'
```

Use `@x402/fetch`, `@x402/mcp`, or `nodeproxy-tools` for automatic payment.

## Deploy on Railway

Railway is the recommended host: full Node.js (JSDOM works), no 15s serverless timeout, metered billing when idle.

### 1. Push to GitHub

```bash
cd NodeProxy
git init && git add . && git commit -m "NodeProxy MCP x402 parser"
git remote add origin https://github.com/YOU/nodeproxy.git
git push -u origin main
```

### 2. Create Railway project

1. Go to [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. Select your repo — Railway reads `railway.toml` + `nixpacks.toml` automatically
3. **Settings → Networking → Generate Domain** (gives you `*.up.railway.app`)

### 3. Set environment variables

In Railway → **Variables**:

| Variable | Value |
|----------|--------|
| `WALLET_ADDRESS` | Your Base wallet (USDC recipient) |
| `X402_NETWORK` | `eip155:8453` |
| `PRICE_USDC` | `0.002` |
| `STEALTH_PRICE_USDC` | `0.05` |
| `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` | Coinbase CDP keys (mainnet facilitator) |
| `MPP_SECRET_KEY` / `STRIPE_SECRET_KEY` | Stripe MPP (optional) |
| `HOST` | `0.0.0.0` |
| `MAX_CONCURRENT_PARSES` | `20` |
| `RATE_LIMIT_PER_MINUTE` | `120` |

You do **not** need to set `PORT` or `PUBLIC_URL` — Railway injects `PORT`, and the app auto-detects `RAILWAY_PUBLIC_DOMAIN` for discovery manifests.

### 4. Verify deploy

```bash
curl https://YOUR-APP.up.railway.app/health
curl https://YOUR-APP.up.railway.app/mcp/tools
curl https://YOUR-APP.up.railway.app/.well-known/x402.json
```

### 5. Register for agent discovery

Open a PR to the [MCP Registry](https://github.com/modelcontextprotocol/registry) with `integrations/mcp-registry/server-entry.json`. Agents hit:

- `https://YOUR-APP.up.railway.app/mcp/tools`
- `https://YOUR-APP.up.railway.app/.well-known/mcp.json`
- `https://YOUR-APP.up.railway.app/.well-known/x402.json`

### Cost expectation

Railway’s free tier gives ~$1/month credit after trial — enough for low traffic (~$0.30–0.50/mo idle). One paid agent call at $0.002 USDC covers that. Scale to Hobby ($5/mo) when bot traffic grows.

**Do not use** Vercel/Cloudflare Workers for this service — JSDOM and 25s fetch timeouts exceed edge limits.

## Production (Base mainnet)

```env
X402_NETWORK=eip155:8453
WALLET_ADDRESS=0xYourWallet
PRICE_USDC=0.002
STEALTH_PRICE_USDC=0.05
```

USDC on Base: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`

## Upstream framework integrations

To get NodeProxy baked into LangChain, CrewAI, and MCP registry discovery:

- **[integrations/UPSTREAM.md](./integrations/UPSTREAM.md)** — fork → PR → merge playbook
- **`integrations/python/`** — `nodeproxy-tools` PyPI package + LangChain/CrewAI wrappers
- **`integrations/typescript/`** — `@nodeproxy/langchain` npm package
- **`integrations/mcp-registry/`** — MCP registry PR template

Quick LangChain example:

```python
pip install "nodeproxy-tools[x402,langchain]"
export EVM_PRIVATE_KEY=0x...

from nodeproxy_tools.langchain import NodeProxyMarkdownTool
tool = NodeProxyMarkdownTool()
markdown = tool.invoke({"url": "https://example.com"})
```

## Naming

**NodeProxy** is registry-ready: boring, predictable, and reads as infrastructure. Tool names (`surface_markdown_parser`, `stealth_markdown_parser`) are chosen so semantic search hits match intent.

## License

MIT

## Part of Gate402

This service is part of the [Gate402](https://gate402.app) x402 agent-API suite — pay-per-call APIs for AI agents over HTTP 402 (USDC on Base). Use it standalone, through the unified storefront + CDP x402 Bazaar at [gate402.app](https://gate402.app), or as an MCP server: `npx -y gate402-mcp`.
