# nodeproxy-tools

<!-- mcp-name: io.github.pgalyen1987/nodeproxy -->

Python clients for **NodeProxy**, **TokenSqueezer**, and **VectorCache** — x402-gated agent APIs.

## Install

**NodeProxy (scrape → markdown)**

```bash
pip install "nodeproxy-tools[x402,langchain]"
export EVM_PRIVATE_KEY=0x...
```

**TokenSqueezer (LLM token compression)**

```bash
pip install "nodeproxy-tools[tokensqueezer]"
# or standalone when published: pip install "tokensqueezer-tools[x402,langchain]"
from tokensqueezer_tools import TokenSqueezerClient
```

**VectorCache (semantic vector cache)**

```bash
pip install "nodeproxy-tools[vectorcache]"
# or standalone when published: pip install "vectorcache-tools[x402,langchain]"
from vectorcache_tools import VectorCacheClient
```

**Everything**

```bash
pip install "nodeproxy-tools[all]"
export EVM_PRIVATE_KEY=0x...
```

## LangChain — NodeProxy

```python
from nodeproxy_tools.langchain import NodeProxyMarkdownTool

tool = NodeProxyMarkdownTool()
print(tool.invoke({"url": "https://example.com"}))
```

## LangChain — TokenSqueezer

```python
from tokensqueezer_tools.langchain import TokenSqueezerTool

tool = TokenSqueezerTool()
tool.invoke({"text": "Long noisy agent feed…"})
```

## LangChain — VectorCache

```python
from vectorcache_tools.langchain import VectorCacheTool

tool = VectorCacheTool()
tool.invoke({"query": "agent swarm lookup", "vector": [0.1, 0.2, 0.3]})
```

## CrewAI

```python
from nodeproxy_tools.crewai import NodeProxyMarkdownTool

tool = NodeProxyMarkdownTool()
print(tool._run("https://example.com"))
```

## CLI

```bash
nodeproxy-parse https://example.com
```

## Publish

```bash
bash /home/me/SAAS/scripts/publish-pypi.sh nodeproxy
```
