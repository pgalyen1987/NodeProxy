from __future__ import annotations

from typing import Optional

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

try:
    from nodeproxy_tools.client import NodeProxyClient, NodeProxyError
    from nodeproxy_tools.constants import DEFAULT_API_URL, TOOL_DESCRIPTION, TOOL_NAME
except ImportError as exc:
    raise ImportError(
        'Install nodeproxy-tools: pip install "nodeproxy-tools[x402,langchain]"'
    ) from exc


class NodeProxyInput(BaseModel):
    """Input for the NodeProxy surface markdown parser."""

    url: str = Field(description="Public website URL to parse into LLM-ready Markdown.")


class NodeProxyMarkdownTool(BaseTool):
    """Tool that fetches a URL via NodeProxy and returns token-efficient Markdown.

    NodeProxy strips scripts, ads, and navigation chrome, returning compressed
    Markdown suitable for LLM context windows. Each call is paid via x402 USDC
    micropayment (requires ``EVM_PRIVATE_KEY`` in the environment).

    .. versionadded:: 0.3.0
    """

    name: str = TOOL_NAME
    description: str = TOOL_DESCRIPTION
    args_schema: type[BaseModel] = NodeProxyInput

    api_url: str = Field(default=DEFAULT_API_URL)
    client: Optional[NodeProxyClient] = Field(default=None)
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def model_post_init(self, __context: object) -> None:
        if self.client is None:
            self.client = NodeProxyClient(api_url=self.api_url)

    def _run(
        self,
        url: str,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        assert self.client is not None
        try:
            return self.client.parse_url_text(url)
        except NodeProxyError as exc:
            return f"NodeProxy error: {exc}"
