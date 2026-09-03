#!/usr/bin/env bash
# Starts the Orchestrator UI, Agentic Team UI, and Context Dashboard together.
set -euo pipefail
cd "$(dirname "$0")/.."

trap 'kill 0' EXIT

npm run run-ui &
npm run run-agentic-ui &
npm run context-dashboard &

wait
