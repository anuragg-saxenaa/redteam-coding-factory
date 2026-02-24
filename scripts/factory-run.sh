#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/factory-run.sh [--help]

This is a placeholder runner that will evolve into:
- create worktree per task
- spawn runtime (process/tmux)
- run coding agent
- open PR and run reaction loop

Next steps: implement Phase-1 POC.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

echo "Factory runner not implemented yet. Run with --help." >&2
exit 2
