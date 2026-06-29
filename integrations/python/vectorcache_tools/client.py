"""x402-aware HTTP client for VectorCache."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any, Literal, Optional, Sequence

from vectorcache_tools.constants import DEFAULT_API_URL

CacheStatus = Literal["hit", "miss", "miss_stored"]


class VectorCacheError(Exception):
    """Raised when VectorCache returns a non-success response."""


@dataclass
class CacheResult:
    cache: CacheStatus
    similarity: float
    vector: Optional[list[float]]
    namespace: Optional[str] = None
    query: Optional[str] = None
    model: Optional[str] = None
    latency_ms: Optional[float] = None
    hits: Optional[int] = None
    hint: Optional[str] = None
    transaction: Optional[str] = None
    network: Optional[str] = None
    price_usdc: Optional[float] = None
    raw: Optional[dict[str, Any]] = None


class VectorCacheClient:
    """
    Calls VectorCache ``POST /vector/cache`` with automatic x402 payment handling.
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
            from vectorcache_tools.x402_setup import build_x402_session
        except ImportError as exc:
            raise VectorCacheError(
                'Install x402 extras: pip install "vectorcache-tools[x402]"'
            ) from exc
        try:
            self._x402_client, self._session = build_x402_session(
                evm_private_key=self.evm_private_key,
                solana_private_key=self.solana_private_key,
            )
        except (ImportError, ValueError) as exc:
            raise VectorCacheError(str(exc)) from exc

    def lookup(
        self,
        query: str,
        *,
        vector: Optional[Sequence[float]] = None,
        namespace: str = "default",
        store_on_miss: bool = True,
    ) -> CacheResult:
        """Semantic cache lookup (and optional store on miss)."""
        self._ensure_x402()
        assert self._session is not None

        payload: dict[str, Any] = {
            "query": query,
            "namespace": namespace,
            "storeOnMiss": store_on_miss,
        }
        if vector is not None:
            payload["vector"] = list(vector)

        with self._session as session:
            response = session.post(
                self.api_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=60,
            )

        if response.status_code != 200:
            detail = response.text[:500]
            try:
                detail = response.json().get("error", detail)
            except json.JSONDecodeError:
                pass
            raise VectorCacheError(f"VectorCache HTTP {response.status_code}: {detail}")

        data = response.json()
        settlement = data.get("settlement") or {}

        return CacheResult(
            cache=data.get("cache", "miss"),
            similarity=float(data.get("similarity", 0)),
            vector=data.get("vector"),
            namespace=data.get("namespace", namespace),
            query=data.get("query", query),
            model=data.get("model"),
            latency_ms=data.get("latencyMs"),
            hits=data.get("hits"),
            hint=data.get("hint"),
            transaction=settlement.get("transaction"),
            network=settlement.get("network"),
            price_usdc=settlement.get("priceUsdc"),
            raw=data,
        )

    def close(self) -> None:
        self._session = None
        self._x402_client = None

    def __enter__(self) -> "VectorCacheClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
