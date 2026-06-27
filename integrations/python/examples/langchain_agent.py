#!/usr/bin/env python3
"""LangChain agent example using NodeProxyMarkdownTool."""

from nodeproxy_tools.langchain import NodeProxyMarkdownTool


def main() -> None:
    tool = NodeProxyMarkdownTool()
    markdown = tool.invoke({"url": "https://example.com"})
    print(markdown[:800])


if __name__ == "__main__":
    main()
