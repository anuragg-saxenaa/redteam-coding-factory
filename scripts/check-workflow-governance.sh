#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_DIR=".github/workflows"

if [[ ! -d "$WORKFLOW_DIR" ]]; then
  echo "No workflow directory found at $WORKFLOW_DIR"
  exit 1
fi

# Keep policy intentionally small: deny by default and only permit audited actions.
ALLOWED_ACTIONS_REGEX='^(actions/checkout|actions/setup-node)$'

status=0

for workflow in "$WORKFLOW_DIR"/*.yml "$WORKFLOW_DIR"/*.yaml; do
  [[ -f "$workflow" ]] || continue

  echo "Checking $workflow"

  # Require explicit top-level read-only token permission for least privilege.
  if ! grep -Eq '^permissions:\s*$' "$workflow"; then
    echo "  ERROR: missing top-level permissions block"
    status=1
  fi

  if ! grep -Eq '^\s*contents:\s*read\s*$' "$workflow"; then
    echo "  ERROR: permissions.contents must be read"
    status=1
  fi

  while IFS= read -r uses_line; do
    ref="${uses_line##*@}"
    action="${uses_line#*uses: }"
    action="${action%@*}"

    if [[ "$action" == ./.github/workflows/* ]]; then
      # Local reusable workflows are versioned in-repo, so SHA pinning is not applicable.
      continue
    fi

    if [[ ! "$action" =~ $ALLOWED_ACTIONS_REGEX ]]; then
      echo "  ERROR: action not allowlisted: $action"
      status=1
    fi

    if [[ ! "$ref" =~ ^[0-9a-f]{40}$ ]]; then
      echo "  ERROR: action must be pinned to a full commit SHA: $uses_line"
      status=1
    fi
  done < <(grep -E '^\s*-\s*uses:\s*' "$workflow")
done

if [[ $status -ne 0 ]]; then
  echo "\nWorkflow governance check failed"
  exit $status
fi

echo "\nWorkflow governance check passed"