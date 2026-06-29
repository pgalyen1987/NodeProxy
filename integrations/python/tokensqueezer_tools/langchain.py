"""LangChain tool wrapper for TokenSqueezer."""

from __future__ import annotations

from typing import Optional, Type

from langchain_core.callbacks import CallbackManagerForToolRun
from langchain_core.tools import BaseTool
from pydantic import BaseModel, ConfigDict, Field

from tokensqueezer_tools.client import TokenSqueezerClient, TokenSqueezerError
from tokensqueezer_tools.constants import TOOL_DESCRIPTION, TOOL_NAME


class TokenSqueezerInput(BaseModel):
    text: str = Field(description="Raw text block to compress for LLM ingestion.")
    aggressive: bool = Field(default=False, description="Strip more filler and parentheticals.")


class TokenSqueezerTool(BaseTool):
    name: str = TOOL_NAME
    description: str = TOOL_DESCRIPTION
    args_schema: Type[BaseModel] = TokenSqueezerInput

    client: TokenSqueezerClient = Field(default_factory=TokenSqueezerClient)
    model_config = ConfigDict(arbitrary_types_allowed=True)

    def _run(
        self,
        text: str,
        aggressive: bool = False,
        run_manager: Optional[CallbackManagerForToolRun] = None,
    ) -> str:
        try:
            return self.client.compress_text(text, aggressive=aggressive)
        except TokenSqueezerError as exc:
            return f"TokenSqueezer error: {exc}"
