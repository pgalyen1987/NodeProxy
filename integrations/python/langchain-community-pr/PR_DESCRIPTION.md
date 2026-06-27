## Summary

Adds **NodeProxyMarkdownTool** — a community tool that calls the open [NodeProxy](https://github.com/pgalyen1987/NodeProxy) MCP service to convert any public URL into token-efficient Markdown for LLM ingestion.

## Why merge this?

- **Token savings**: strips scripts, nav, ads, and HTML noise (~70% fewer tokens vs raw page HTML).
- **Zero API keys**: uses [x402](https://x402.org) USDC micropayments; agents pay per parse with `EVM_PRIVATE_KEY`.
- **Thin wrapper**: logic lives in published [`nodeproxy-tools`](https://pypi.org/project/nodeproxy-tools/) package; this PR is ~60 lines.
- **Agent-native**: tool name and description match MCP registry / x402 Bazaar discovery strings.

## Usage

```python
from langchain_community.tools import NodeProxyMarkdownTool

tool = NodeProxyMarkdownTool()
markdown = tool.invoke({"url": "https://docs.python.org/3/"})
```

Requires:

```bash
pip install "langchain-community[nodeproxy]"
export EVM_PRIVATE_KEY=0x...  # funded on Base Sepolia or Base mainnet
```

## Test plan

- [ ] `NodeProxyMarkdownTool` import succeeds with optional extra installed
- [ ] Unit test mocks `NodeProxyClient.parse_url_text` (no live payment in CI)
- [ ] Tool schema exposes `url: str` with description for agent routing
- [ ] Manual smoke test against `https://nodeproxy-production.up.railway.app` (optional)

## Live service

| Endpoint | URL |
|----------|-----|
| Health | https://nodeproxy-production.up.railway.app/health |
| Tools | https://nodeproxy-production.up.railway.app/mcp/tools |
| Execute | https://nodeproxy-production.up.railway.app/mcp/execute |

Default price: **$0.002 USDC** per parse on Base Sepolia (testnet) or Base mainnet.
