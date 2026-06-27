"""LangChain ``BaseTool`` wrapper for NodeProxy."""

from __future__ import annotations

from typing import Optional, Type

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from nodeproxy_tools.client import NodeProxyClient, NodeProxyError
from nodeproxy_tools.constants import TOOL_DESCRIPTION, TOOL_NAME


class NodeProxyInput(BaseModel):
    """Input schema for the NodeProxy markdown parser."""

    url: str = Field(description="Public website URL to parse into LLM-ready Markdown.")


class NodeProxyMarkdownTool(BaseTool):
    """
    LangChain tool that calls the NodeProxy x402-gated web surface parser.

    .. versionadded:: 0.1.0
    """

    name: str = TOOL_NAME
    description: str = TOOL_DESCRIPTION
    args_schema: Type[BaseModel] = NodeProxyInput

    client: NodeProxyClient = Field(default_factory=NodeProxyClient)
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def _run(
        self,
        url: str,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        try:
            return self.client.parse_url_text(url)
        except NodeProxyError as exc:
            return f"NodeProxy error: {exc}"
