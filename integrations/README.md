# NodeProxy upstream integrations

Ship NodeProxy as a **default dependency** in agent frameworks instead of a standalone script agents must discover manually.

| Package | Install | Use case |
|---------|---------|----------|
| Python (`nodeproxy-tools`) | `pip install nodeproxy-tools[x402,langchain]` | LangChain / CrewAI agents |
| TypeScript (`@nodeproxy/langchain`) | `npm install @nodeproxy/langchain` | LangChain.js agents |
| MCP Registry | PR to `modelcontextprotocol/registry` | Global MCP discovery |

**Production endpoint:** `https://nodeproxy-production.up.railway.app/mcp/execute`

## Quick start (Python + LangChain)

```bash
pip install "nodeproxy-tools[x402,langchain]"
export EVM_PRIVATE_KEY=0x...   # funded wallet on Base Sepolia or Base mainnet
```

```python
from nodeproxy_tools import NodeProxyClient
from nodeproxy_tools.langchain import NodeProxyMarkdownTool

client = NodeProxyClient()  # reads EVM_PRIVATE_KEY
tool = NodeProxyMarkdownTool(client=client)

markdown = tool.invoke({"url": "https://example.com"})
```

## Upstream PR playbook

See **[UPSTREAM.md](./UPSTREAM.md)** for the exact fork → PR → merge workflow for:

1. `langchain-ai/langchain-community` (Python tool)
2. `modelcontextprotocol/registry` (MCP server listing)
3. Publishing `nodeproxy-tools` to PyPI (optional but recommended before upstream PR)

Pre-built PR artifacts live in:

- `python/langchain-community-pr/` — copy into a langchain-community fork
- `mcp-registry/` — registry submission JSON + PR body
