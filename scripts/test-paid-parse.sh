#!/usr/bin/env bash
# End-to-end paid parse against production NodeProxy.
# Requires: EVM_PRIVATE_KEY with USDC on Base mainnet (~$0.01 is enough)
set -euo pipefail

if [[ -z "${EVM_PRIVATE_KEY:-}" ]]; then
  echo "Set EVM_PRIVATE_KEY to a wallet funded with Base USDC."
  exit 1
fi

pip install -q "nodeproxy-tools[x402]" 2>/dev/null || pip install "nodeproxy-tools[x402]" --break-system-packages -q

python3 <<'PY'
import os
from nodeproxy_tools import NodeProxyClient

client = NodeProxyClient()
result = client.parse_url("https://example.com")
print("Settlement tx:", result.transaction)
print("Network:", result.network)
print("Markdown preview:", result.markdown[:400])
PY
