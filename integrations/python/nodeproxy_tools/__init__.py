"""NodeProxy client + framework integrations for upstream agent packages."""

from nodeproxy_tools.client import NodeProxyClient, NodeProxyError, ParseResult
from nodeproxy_tools.constants import DEFAULT_API_URL, TOOL_DESCRIPTION, TOOL_NAME

try:
    from nodeproxy_tools.langchain import NodeProxyMarkdownTool as LangChainNodeProxyTool
except ImportError:
    LangChainNodeProxyTool = None  # type: ignore[misc, assignment]

__all__ = [
    "DEFAULT_API_URL",
    "LangChainNodeProxyTool",
    "NodeProxyClient",
    "NodeProxyError",
    "ParseResult",
    "TOOL_DESCRIPTION",
    "TOOL_NAME",
]

__version__ = "0.2.0"
