#!/usr/bin/env bash
# Publish @nodeproxy/langchain to npm (public scoped package).
# Requires: NPM_TOKEN from https://www.npmjs.com/settings/~/tokens (Automation, publish)
# First time: create free org "nodeproxy" at https://www.npmjs.com/org/create if needed.
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"

if [[ -z "${NPM_TOKEN:-}" && -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT}/.env"
  set +a
fi

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "Add NPM_TOKEN to ${ROOT}/.env (npm Automation token with publish access)."
  echo "  NPM_TOKEN=npm_..."
  exit 1
fi

npm run build
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > .npmrc
trap 'rm -f .npmrc' EXIT

npm publish --access public

echo "Published: https://www.npmjs.com/package/@nodeproxy/langchain"
