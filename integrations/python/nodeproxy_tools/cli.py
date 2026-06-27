"""CLI entrypoint for quick NodeProxy smoke tests."""

from __future__ import annotations

import sys

from nodeproxy_tools.client import NodeProxyClient, NodeProxyError


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: nodeproxy-parse <url>", file=sys.stderr)
        raise SystemExit(2)

    url = sys.argv[1]
    client = NodeProxyClient()
    try:
        result = client.parse_url(url)
    except NodeProxyError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    if result.transaction:
        print(f"# settled: {result.transaction} ({result.network})", file=sys.stderr)
    print(result.markdown)


if __name__ == "__main__":
    main()
