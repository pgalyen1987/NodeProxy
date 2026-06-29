"""LangChain tool wrapper for VectorCache."""

from __future__ import annotations

from typing import Optional, Sequence, Type

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from vectorcache_tools.client import VectorCacheClient, VectorCacheError
from vectorcache_tools.constants import TOOL_DESCRIPTION, TOOL_NAME


class VectorCacheInput(BaseModel):
    query: str = Field(description="Text to look up in the semantic vector cache.")
    namespace: str = Field(default="default", description="Cache namespace for agent swarms.")
    vector: Optional[list[float]] = Field(
        default=None,
        description="Embedding vector to store when cache misses.",
    )


class VectorCacheTool(BaseTool):
    name: str = TOOL_NAME
    description: str = TOOL_DESCRIPTION
    args_schema: Type[BaseModel] = VectorCacheInput

    client: VectorCacheClient = Field(default_factory=VectorCacheClient)
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def _run(
        self,
        query: str,
        namespace: str = "default",
        vector: Optional[Sequence[float]] = None,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        try:
            result = self.client.lookup(query, vector=vector, namespace=namespace)
            if result.vector is None:
                return f"cache={result.cache} similarity={result.similarity:.3f} (no vector)"
            return f"cache={result.cache} similarity={result.similarity:.3f} vector={result.vector[:8]}…"
        except VectorCacheError as exc:
            return f"VectorCache error: {exc}"
