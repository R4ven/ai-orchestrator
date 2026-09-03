#!/usr/bin/env bash
set -euo pipefail

echo "Installing AI Orchestrator (TypeScript monorepo)..."
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install it first (e.g. via nvm) and re-run this script." >&2
  exit 1
fi

node_major=$(node -p "process.versions.node.split('.')[0]")
if [ "$node_major" -lt 20 ]; then
  echo "Node.js 20+ is required (found $(node -v))." >&2
  exit 1
fi

npm install
npm run build

echo ""
echo "Done. Try:"
echo "  npm run desktop          # Electron desktop app (Orchestrator, Agentic Team, Local Models)"
echo "  npm run orchestrator -- --help"
echo "  npm run agentic-team -- --help"
