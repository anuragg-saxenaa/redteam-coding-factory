#!/usr/bin/env bash
set -euo pipefail

# RedTeam CI/CD entrypoint
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Logging
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/run-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1

echo "=== RedTeam CI/CD Run $(date) ==="

# Validate required config files
if [[ ! -f factory.config.json ]]; then
  echo "ERROR: factory.config.json not found"
  exit 1
fi

if [[ ! -f tasks.json ]]; then
  echo "ERROR: tasks.json not found"
  exit 1
fi

# Run factory with given config
echo "Running redteam-factory with factory.config.json..."
node src/cli.js run --config factory.config.json --tasks tasks.json

EXIT_CODE=$?
if [[ $EXIT_CODE -ne 0 ]]; then
  echo "Factory run failed with exit code $EXIT_CODE"
  exit $EXIT_CODE
fi

echo "Factory run completed successfully"