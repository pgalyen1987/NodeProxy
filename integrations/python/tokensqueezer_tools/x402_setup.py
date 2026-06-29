"""Register EVM and/or Solana x402 payers on a sync client."""

from __future__ import annotations

import json
import os
from typing import Optional, Tuple

from x402 import x402ClientSync
from x402.http.clients import x402_requests


def build_x402_session(
    *,
    evm_private_key: Optional[str] = None,
    solana_private_key: Optional[str] = None,
) -> Tuple[x402ClientSync, object]:
    evm_key = evm_private_key or os.getenv("EVM_PRIVATE_KEY")
    sol_key = solana_private_key or os.getenv("SOLANA_PRIVATE_KEY")
    if not evm_key and not sol_key:
        raise ValueError("EVM_PRIVATE_KEY or SOLANA_PRIVATE_KEY is required for paid calls.")

    try:
        from x402.mechanisms.evm import EthAccountSigner
        from x402.mechanisms.evm.exact.register import register_exact_evm_client
    except ImportError as exc:
        raise ImportError('Install x402 extras: pip install "tokensqueezer-tools[x402]"') from exc

    client = x402ClientSync()

    if evm_key:
        from eth_account import Account

        register_exact_evm_client(client, EthAccountSigner(Account.from_key(evm_key)))

    if sol_key:
        try:
            from x402.mechanisms.svm.exact.register import register_exact_svm_client
            from x402.mechanisms.svm.signers import KeypairSigner
        except ImportError as exc:
            raise ImportError(
                'Solana payments require x402[svm] (solders). '
                'pip install "tokensqueezer-tools[x402]"'
            ) from exc

        raw = sol_key.strip()
        if raw.startswith("["):
            signer = KeypairSigner.from_bytes(bytes(json.loads(raw)))
        else:
            signer = KeypairSigner.from_base58(raw)
        register_exact_svm_client(client, signer)

    return client, x402_requests(client)
