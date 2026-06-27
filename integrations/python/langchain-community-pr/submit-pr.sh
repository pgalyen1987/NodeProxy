#!/usr/bin/env bash
# Open LangChain Community PR for NodeProxyMarkdownTool.
# Requires: gh auth login  (one-time: https://github.com/login/device)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="/tmp/langchain-community-nodeproxy-pr"
UPSTREAM="langchain-ai/langchain-community"

if ! gh auth status >/dev/null 2>&1; then
  echo "Run: gh auth login -h github.com -p ssh -w"
  exit 1
fi

FORK="$(gh api user --jq .login)/langchain-community"

echo "Forking $UPSTREAM if needed..."
gh repo fork "$UPSTREAM" --clone=false 2>/dev/null || true

rm -rf "$WORK"
gh repo clone "$FORK" "$WORK" -- --depth 1
cd "$WORK"

git checkout -b feat/nodeproxy-x402-markdown-tool

cp -r "$ROOT/langchain-community-pr/nodeproxy" libs/community/langchain_community/tools/
mkdir -p libs/community/tests/unit_tests/tools/nodeproxy
cp "$ROOT/langchain-community-pr/tests/test_nodeproxy_tool.py" \
  libs/community/tests/unit_tests/tools/nodeproxy/test_nodeproxy_tool.py

python3 <<'PY'
from pathlib import Path
init = Path("libs/community/langchain_community/tools/__init__.py")
text = init.read_text()
needle = '    from langchain_community.tools.nasa.tool import (\n        NasaAction,\n    )\n'
insert = needle + '    from langchain_community.tools.nodeproxy.tool import (\n        NodeProxyMarkdownTool,\n    )\n'
if "NodeProxyMarkdownTool" not in text:
    text = text.replace(needle, insert)
    text = text.replace('    "NasaAction",\n    "NavigateBackTool",', '    "NasaAction",\n    "NodeProxyMarkdownTool",\n    "NavigateBackTool",')
    text = text.replace(
        '    "NasaAction": "langchain_community.tools.nasa.tool",\n    "NavigateBackTool":',
        '    "NasaAction": "langchain_community.tools.nasa.tool",\n    "NodeProxyMarkdownTool": "langchain_community.tools.nodeproxy.tool",\n    "NavigateBackTool":',
    )
    init.write_text(text)
PY

git add libs/community/langchain_community/tools/nodeproxy \
  libs/community/langchain_community/tools/__init__.py \
  libs/community/tests/unit_tests/tools/nodeproxy
git commit -m "feat(community): add NodeProxy x402 markdown parser tool"

git push -u origin feat/nodeproxy-x402-markdown-tool

PR_URL=$(gh pr create \
  --repo "$UPSTREAM" \
  --head "$FORK:feat/nodeproxy-x402-markdown-tool" \
  --title "feat(community): add NodeProxy x402 markdown parser tool" \
  --body-file "$ROOT/langchain-community-pr/PR_DESCRIPTION.md")

echo "PR opened: $PR_URL"
