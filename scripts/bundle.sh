#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$ROOT_DIR"

echo "==> Installing dependencies (frozen)..."
deno install --frozen --config ./trusted-deno.json

echo "==> Bundling PDS into bundle.js..."
deno bundle --frozen --config ./trusted-deno.json -o bundle.js main.ts

echo "==> Done: bundle.js"
