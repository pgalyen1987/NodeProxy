"""x402-aware HTTP client for the NodeProxy surface markdown parser."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Optional

from nodeproxy_tools.constants import DEFAULT_API_URL, TOOL_NAME


class NodeProxyError(Exception):
    """Raised when NodeProxy returns a non-success response."""


@dataclass
class ParseResult:
    """Successful parse payload."""

    markdown: str
    transaction: Optional[str] = None
    network: Optional[str] = None
    raw: Optional[dict[str, Any]] = None


class NodeProxyClient:
    """
    Calls NodeProxy ``POST /mcp/execute`` with automatic x402 payment handling.

    Requires ``EVM_PRIVATE_KEY`` (or pass ``evm_private_key=``) with USDC on a
    supported network (Base, Polygon, Arbitrum, or Ethereum mainnet).
    """

    def __init__(
        self,
        *,
        api_url: str = DEFAULT_API_URL,
        evm_private_key: Optional[str] = None,
        solana_private_key: Optional[str] = None,
        max_price_usdc: float = 0.05,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.evm_private_key = evm_private_key or os.getenv("EVM_PRIVATE_KEY")
        self.solana_private_key = solana_private_key or os.getenv("SOLANA_PRIVATE_KEY")
        self.max_price_usdc = max_price_usdc
        self._session = None
        self._x402_client = None

    def _ensure_x402(self) -> None:
        if self._x402_client is not None:
            return

        try:
            from nodeproxy_tools.x402_setup import build_x402_session
        except ImportError as exc:
            raise NodeProxyError(
                'Install x402 extras: pip install "nodeproxy-tools[x402]"'
            ) from exc

        try:
            self._x402_client, self._session = build_x402_session(
                evm_private_key=self.evm_private_key,
                solana_private_key=self.solana_private_key,
            )
        except (ImportError, ValueError) as exc:
            raise NodeProxyError(str(exc)) from exc

    def parse_url(self, url: str) -> ParseResult:
        """Fetch *url* via NodeProxy and return cleaned Markdown."""
        self._ensure_x402()
        assert self._session is not None

        payload = {"tool": TOOL_NAME, "arguments": {"url": url}}

        with self._session as session:
            response = session.post(
                self.api_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=120,
            )

        if response.status_code != 200:
            detail = response.text[:500]
            try:
                detail = response.json().get("error", detail)
            except json.JSONDecodeError:
                pass
            raise NodeProxyError(f"NodeProxy HTTP {response.status_code}: {detail}")

        data = response.json()
        content = data.get("content") or []
        if not content or not content[0].get("text"):
            raise NodeProxyError(f"Unexpected NodeProxy response shape: {data!r}")

        settlement = data.get("settlement") or {}
        return ParseResult(
            markdown=content[0]["text"],
            transaction=settlement.get("transaction"),
            network=settlement.get("network"),
            raw=data,
        )

    def parse_url_text(self, url: str) -> str:
        """Convenience wrapper returning Markdown string only."""
        return self.parse_url(url).markdown

    def close(self) -> None:
        """Release underlying HTTP session if held."""
        self._session = None
        self._x402_client = None

    def __enter__(self) -> "NodeProxyClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
