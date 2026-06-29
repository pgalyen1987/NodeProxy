from vectorcache_tools.client import CacheResult, VectorCacheClient, VectorCacheError
from vectorcache_tools.constants import DEFAULT_API_URL, TOOL_DESCRIPTION, TOOL_NAME

try:
    from vectorcache_tools.langchain import VectorCacheTool
except ImportError:
    VectorCacheTool = None  # type: ignore[misc, assignment]

__all__ = [
    "DEFAULT_API_URL",
    "CacheResult",
    "VectorCacheClient",
    "VectorCacheError",
    "VectorCacheTool",
    "TOOL_DESCRIPTION",
    "TOOL_NAME",
]

__version__ = "0.1.0"
