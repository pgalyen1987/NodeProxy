# NodeProxy

**Self-discoverable MCP utility for autonomous agents** — no ads, no landing page, no human in the loop.

NodeProxy exposes `surface_markdown_parser`: a micro-service that fetches any public URL, strips scripts/ads/nav noise, and returns compressed Markdown optimized for LLM context windows. Every call is gated by **x402 v2** USDC payments on Base.

Agents find this tool through **MCP registries**, **x402 Bazaar discovery**, and machine-readable manifests — not marketing.

## Why agents need this

Heavy React/Vue sites burn tokens when agents ingest raw HTML. NodeProxy returns clean Markdown so autonomous retrieval loops stay cheap and accurate.

## Architecture

```
Autonomous Agent
    │  search MCP registry / Bazaar (vector or keyword)
    ▼
GET /mcp/tools  or  MCP list_tools
    │  reads JSON schema ("Machine UI")
    ▼
POST /mcp/execute  or  tools/call surface_markdown_parser
    │  no PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED
    │  with signature → facilitator verify/settle → parse URL
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
| `GET /mcp/tools` | Tool catalog for registry crawlers |
| `POST /mcp/execute` | HTTP execution + x402 gate |
| `ALL /mcp` | Streamable HTTP MCP transport |
| `GET /.well-known/mcp.json` | Well-known discovery |
| `GET /registry/server.json` | Submit this URL to [MCP Registry](https://github.com/modelcontextprotocol/registry) |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `WALLET_ADDRESS` | — | USDC recipient (your revenue) |
| `PRICE_USDC` | `0.002` | Price per successful parse |
| `X402_NETWORK` | `eip155:84532` | Use `eip155:8453` for Base mainnet |
| `FACILITATOR_URL` | `https://x402.org/facilitator` | x402 facilitator |
| `PUBLIC_URL` | localhost | Used in discovery manifests |

## Machine discovery (zero advertising)

1. **Deploy** to Fly.io, Railway, or any HTTPS host.
2. **Update** `registry/server.json` with your live URL.
3. **Submit PR** to the [open-source MCP Registry](https://github.com/modelcontextprotocol/registry) — agents scanning registries will index your schema.
4. **Bazaar auto-index**: after the first successful x402 settlement through a Bazaar-enabled facilitator, your tool appears in `/discovery/resources` ([Bazaar docs](https://docs.x402.org/extensions/bazaar)).
5. **Enterprise hubs** (Google Agent Registry, Anthropic routing): point them at `/.well-known/mcp.json`.

The tool description is written for **LLM tool-matching**, not humans:

> *"Executes fetch on any public URL, strips scripts/ads/nav noise, and returns compressed semantic Markdown optimized for LLM token ingestion."*

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
# Stage A — get 402 challenge
curl -i "http://localhost:4022/mcp/execute" \
  -H 'Content-Type: application/json' \
  -d '{"tool":"surface_markdown_parser","arguments":{"url":"https://example.com"}}'

# Stage B — retry with PAYMENT-SIGNATURE from x402 client wallet
curl "http://localhost:4022/mcp/execute" \
  -H 'Content-Type: application/json' \
  -H 'PAYMENT-SIGNATURE: <base64>' \
  -d '{"tool":"surface_markdown_parser","arguments":{"url":"https://example.com"}}'
```

Use `@x402/fetch` or `@x402/mcp` client wrappers for automatic payment.

## Deploy on Railway

Railway is the recommended host for this parser: full Node.js (JSDOM works), no 15s serverless timeout, metered billing when idle.

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
| `FACILITATOR_URL` | `https://x402.org/facilitator` |
| `HOST` | `0.0.0.0` |
| `MAX_CONCURRENT_PARSES` | `20` |
| `RATE_LIMIT_PER_MINUTE` | `120` |

You do **not** need to set `PORT` or `PUBLIC_URL` — Railway injects `PORT`, and the app auto-detects `RAILWAY_PUBLIC_DOMAIN` for discovery manifests.

### 4. Verify deploy

```bash
curl https://YOUR-APP.up.railway.app/health
curl https://YOUR-APP.up.railway.app/mcp/tools
```

### 5. Register for agent discovery

Update `registry/server.json` with your Railway URL, then PR to the [MCP Registry](https://github.com/modelcontextprotocol/registry). Agents hit:

- `https://YOUR-APP.up.railway.app/mcp/tools`
- `https://YOUR-APP.up.railway.app/.well-known/mcp.json`

### Cost expectation

Railway’s free tier gives ~$1/month credit after trial — enough for low traffic (~$0.30–0.50/mo idle). One paid agent call at $0.002 USDC covers that. Scale to Hobby ($5/mo) when bot traffic grows.

**Do not use** Vercel/Cloudflare Workers for this service — JSDOM and 25s fetch timeouts exceed edge limits.

## Production (Base mainnet)

```env
X402_NETWORK=eip155:8453
WALLET_ADDRESS=0xYourWallet
PRICE_USDC=0.002
```

USDC on Base: `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`

## Upstream framework integrations

To get NodeProxy baked into LangChain, CrewAI, and MCP registry discovery (instead of hoping agents find your URL), see:

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

**NodeProxy** is registry-ready: boring, predictable, and reads as infrastructure. The paid tool name remains `surface_markdown_parser` so semantic search hits match intent.

## License

MIT
