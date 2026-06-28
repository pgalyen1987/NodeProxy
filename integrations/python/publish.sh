#!/usr/bin/env bash
# Publish nodeproxy-tools to PyPI.
# Requires: PYPI_TOKEN from https://pypi.org/manage/account/token/
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"

if [[ -z "${PYPI_TOKEN:-}" && -f "${ROOT}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ROOT}/.env"
  set +a
fi

if [[ -z "${PYPI_TOKEN:-}" ]]; then
  echo "Add PYPI_TOKEN to ${ROOT}/.env (PyPI API token with upload scope)."
  exit 1
fi

python3 -m build
TWINE_USERNAME=__token__ TWINE_PASSWORD="${PYPI_TOKEN}" twine upload dist/*
echo "Published: https://pypi.org/project/nodeproxy-tools/"
