# nodeproxy-tools

<!-- mcp-name: io.github.pgalyen1987/nodeproxy -->

Python client and framework wrappers for [NodeProxy](https://github.com/pgalyen1987/NodeProxy).

## Install

```bash
pip install "nodeproxy-tools[x402,langchain]"
export EVM_PRIVATE_KEY=0x...
```

## LangChain

```python
from nodeproxy_tools.langchain import NodeProxyMarkdownTool

tool = NodeProxyMarkdownTool()
print(tool.invoke({"url": "https://example.com"}))
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
