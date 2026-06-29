"""x402-aware HTTP client for TokenSqueezer."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional

from tokensqueezer_tools.constants import DEFAULT_API_URL

Format = Literal["auto", "plain", "markdown", "json"]


class TokenSqueezerError(Exception):
    """Raised when TokenSqueezer returns a non-success response."""


@dataclass
class CompressStats:
    input_tokens: int
    output_tokens: int
    tokens_saved: int
    reduction_percent: float
    input_chars: int
    output_chars: int


@dataclass
class CompressResult:
    compressed: str
    format: str
    stats: CompressStats
    transaction: Optional[str] = None
    network: Optional[str] = None
    price_usdc: Optional[float] = None
    raw: Optional[dict[str, Any]] = None


class TokenSqueezerClient:
    """
    Calls TokenSqueezer ``POST /compress`` with automatic x402 payment handling.

    Requires ``EVM_PRIVATE_KEY`` (or pass ``evm_private_key=``) with USDC on a
    supported network (Base, Polygon, Arbitrum, or Ethereum mainnet).
    """

    def __init__(
        self,
        *,
        api_url: str = DEFAULT_API_URL,
        evm_private_key: Optional[str] = None,
        solana_private_key: Optional[str] = None,
    ) -> None:
        self.api_url = api_url.rstrip("/")
        self.evm_private_key = evm_private_key or os.getenv("EVM_PRIVATE_KEY")
        self.solana_private_key = solana_private_key or os.getenv("SOLANA_PRIVATE_KEY")
        self._session = None
        self._x402_client = None

    def _ensure_x402(self) -> None:
        if self._x402_client is not None:
            return
        try:
            from tokensqueezer_tools.x402_setup import build_x402_session
        except ImportError as exc:
            raise TokenSqueezerError(
                'Install x402 extras: pip install "tokensqueezer-tools[x402]"'
            ) from exc
        try:
            self._x402_client, self._session = build_x402_session(
                evm_private_key=self.evm_private_key,
                solana_private_key=self.solana_private_key,
            )
        except (ImportError, ValueError) as exc:
            raise TokenSqueezerError(str(exc)) from exc

    def compress(
        self,
        text: str,
        *,
        format: Format = "auto",
        aggressive: bool = False,
    ) -> CompressResult:
        """Compress *text* and return densified output + token savings stats."""
        self._ensure_x402()
        assert self._session is not None

        payload = {"text": text, "format": format, "aggressive": aggressive}

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
            raise TokenSqueezerError(f"TokenSqueezer HTTP {response.status_code}: {detail}")

        data = response.json()
        stats_raw = data.get("stats") or {}
        settlement = data.get("settlement") or {}

        return CompressResult(
            compressed=data.get("compressed", ""),
            format=data.get("format", format),
            stats=CompressStats(
                input_tokens=int(stats_raw.get("inputTokens", 0)),
                output_tokens=int(stats_raw.get("outputTokens", 0)),
                tokens_saved=int(stats_raw.get("tokensSaved", 0)),
                reduction_percent=float(stats_raw.get("reductionPercent", 0)),
                input_chars=int(stats_raw.get("inputChars", 0)),
                output_chars=int(stats_raw.get("outputChars", 0)),
            ),
            transaction=settlement.get("transaction"),
            network=settlement.get("network"),
            price_usdc=settlement.get("priceUsdc"),
            raw=data,
        )

    def compress_text(self, text: str, **kwargs: Any) -> str:
        """Return compressed string only."""
        return self.compress(text, **kwargs).compressed

    def close(self) -> None:
        self._session = None
        self._x402_client = None

    def __enter__(self) -> "TokenSqueezerClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
