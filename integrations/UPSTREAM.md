# Upstream package dependency playbook

Goal: when a developer runs `pip install langchain-community` or scans the MCP registry, **NodeProxy is already wired in** and every tool call routes to your x402-gated Railway endpoint.

---

## Phase 1 — Publish a standalone client (do this first)

Upstream maintainers prefer integrations that depend on a **published package**, not hard-coded HTTP calls scattered in their repo.

### 1. Publish `nodeproxy-tools` to PyPI

From `integrations/python/`:

```bash
cd integrations/python
python -m build
twine upload dist/*
```

Package layout is in `nodeproxy_tools/`. Extras:

| Extra | Installs |
|-------|----------|
| `x402` | `x402[requests,evm]`, `eth-account` |
| `langchain` | `langchain-core` |
| `crewai` | `crewai` |
| `all` | everything |

### 2. Smoke test before any PR

```bash
export EVM_PRIVATE_KEY=0xYOUR_KEY
python examples/quickstart.py
python examples/langchain_agent.py
```

Confirm you see Markdown back and a `PAYMENT-RESPONSE` settlement header in logs.

---

## Phase 2 — LangChain Community PR

Target repo: **https://github.com/langchain-ai/langchain-community**

LangChain moved community tools out of the monorepo. New tools go under:

```
libs/community/langchain_community/tools/nodeproxy/
```

### Steps

1. **Fork** `langchain-ai/langchain-community`.
2. **Copy** the PR-ready folder:
   ```bash
   cp -r integrations/python/langchain-community-pr/nodeproxy \
     /path/to/langchain-community/libs/community/langchain_community/tools/
   ```
3. **Register exports** in `langchain_community/tools/__init__.py`:
   ```python
   from langchain_community.tools.nodeproxy.tool import NodeProxyMarkdownTool
   ```
   Add to `__all__` following existing patterns in that file.
4. **Add dependency** in `libs/community/pyproject.toml` (optional extra pattern used by other tools):
   ```toml
   nodeproxy = ["nodeproxy-tools[x402,langchain]>=0.1.0"]
   ```
5. **Add unit test** (mock HTTP — see other tools under `libs/community/tests/unit_tests/tools/`).
6. **Open PR** with title:
   ```
   feat(community): add NodeProxy x402 markdown parser tool
   ```
7. **PR body** — use `python/langchain-community-pr/PR_DESCRIPTION.md`.

### Maintainer pitch (keep this in the PR)

- Offloads JSDOM + HTML cleanup to a hosted MCP service.
- Returns **token-efficient Markdown** (~70% fewer tokens vs raw HTML).
- Uses **x402 micropayments** — no API keys, no accounts; agents pay per request in USDC.
- Depends on published `nodeproxy-tools` package (thin wrapper in community repo).

### After merge

Developers install with:

```bash
pip install "langchain-community[nodeproxy]"
```

Or configure manually:

```python
from langchain_community.tools import NodeProxyMarkdownTool

tool = NodeProxyMarkdownTool()  # uses EVM_PRIVATE_KEY env
agent = create_react_agent(llm, [tool, ...])
```

---

## Phase 3 — MCP Registry PR

Target repo: **https://github.com/modelcontextprotocol/registry**

This puts NodeProxy in the **global MCP server index** that Claude Desktop, Cursor, and registry crawlers read.

### Steps

1. Fork `modelcontextprotocol/registry`.
2. Add an entry using `integrations/mcp-registry/server-entry.json` as a template.
3. Point `url` at your live manifest:
   - Tools catalog: `https://nodeproxy-production.up.railway.app/mcp/tools`
   - MCP transport: `https://nodeproxy-production.up.railway.app/mcp`
   - Well-known: `https://nodeproxy-production.up.railway.app/.well-known/mcp.json`
4. Open PR with body from `mcp-registry/PR_DESCRIPTION.md`.

Registry maintainers verify:

- HTTPS endpoint is live (`GET /health` → 200)
- Tool schema is valid JSON
- Server responds to MCP `list_tools`

---

## Phase 4 — CrewAI (standalone package, optional upstream)

CrewAI encourages **standalone tool packages** rather than core-repo PRs.

Ship `nodeproxy-tools[crewai]` (already included):

```python
from nodeproxy_tools.crewai import NodeProxyMarkdownTool

researcher = Agent(
    role="Research Analyst",
    tools=[NodeProxyMarkdownTool()],
    ...
)
```

To get listed in CrewAI docs, follow: https://docs.crewai.com/en/guides/tools/publish-custom-tools

---

## Phase 5 — LangChain.js (npm)

Publish `@nodeproxy/langchain` from `integrations/typescript/`:

```bash
cd integrations/typescript
npm install && npm run build
npm publish --access public
```

Usage:

```typescript
import { NodeProxyMarkdownTool } from "@nodeproxy/langchain";

const tool = new NodeProxyMarkdownTool({ evmPrivateKey: process.env.EVM_PRIVATE_KEY! });
const md = await tool.invoke({ url: "https://example.com" });
```

Optional PR to `@langchain/community` npm package using the same pattern as Python.

---

## Phase 6 — LlamaIndex (llama-hub)

Target: **https://github.com/run-llama/llama_index**

LlamaIndex uses `llama-hub` loaders/tools. Create a `LlamaTools` wrapper:

```python
# llama_hub/tools/nodeproxy/tool.py
from nodeproxy_tools import NodeProxyClient

def get_tools():
    client = NodeProxyClient()
    return [NodeProxyMarkdownFunctionTool(client)]
```

Submit PR to `run-llama/llama_index` under `llama-hub/llama_hub/tools/nodeproxy/`.

---

## Checklist before opening any upstream PR

- [ ] Production URL returns `GET /health` → `{ "ok": true }`
- [ ] `GET /mcp/tools` lists `surface_markdown_parser`
- [ ] Test payment succeeds on your target network (Sepolia or Base mainnet)
- [ ] Client package published or linked in PR description
- [ ] Tool `description` is written for **LLM tool selection**, not marketing
- [ ] No secrets in code (private keys via env only)
- [ ] README links to https://github.com/pgalyen1987/NodeProxy

---

## Revenue loop after merge

```
Developer installs framework
    → NodeProxy tool is importable by default
    → Agent selects surface_markdown_parser for web tasks
    → POST /mcp/execute → 402 → wallet signs → parse → USDC to your WALLET_ADDRESS
```

Every merged upstream PR is a **distribution channel** that compounds: no ads, no landing page, pure machine discovery.
