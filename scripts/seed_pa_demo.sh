#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -x "./.venv313/bin/python" ]]; then
  PYTHON_BIN="./.venv313/bin/python"
elif [[ -x "./.venv/bin/python" ]]; then
  PYTHON_BIN="./.venv/bin/python"
else
  PYTHON_BIN="python3"
fi

echo "Using Python: ${PYTHON_BIN}"
"${PYTHON_BIN}" ./scripts/seed_pa_demo.py
