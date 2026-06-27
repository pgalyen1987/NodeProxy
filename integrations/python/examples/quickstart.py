#!/usr/bin/env python3
"""Minimal NodeProxy smoke test — requires EVM_PRIVATE_KEY."""

from nodeproxy_tools import NodeProxyClient

URL = "https://example.com"


def main() -> None:
    client = NodeProxyClient()
    result = client.parse_url(URL)
    print(f"Settled: {result.transaction} on {result.network}")
    print(result.markdown[:500], "...")


if __name__ == "__main__":
    main()
