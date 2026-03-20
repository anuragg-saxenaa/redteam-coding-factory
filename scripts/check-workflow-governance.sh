#!/usr/bin/env bash
set -euo pipefail

WORKFLOW_DIR=".github/workflows"

if [[ ! -d "$WORKFLOW_DIR" ]]; then
  echo "No workflow directory found at $WORKFLOW_DIR"
  exit 1
fi

# Keep policy intentionally small: deny by default and only permit audited actions.
ALLOWED_ACTIONS_REGEX='^(actions/checkout|actions/setup-node)$'
OIDC_ACTIONS_REGEX='^(aws-actions/configure-aws-credentials|azure/login|google-github-actions/auth)$'
FORBIDDEN_STATIC_SECRETS_REGEX='AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN|AZURE_CLIENT_SECRET|GOOGLE_CREDENTIALS|GCP_SERVICE_ACCOUNT_KEY|GCLOUD_SERVICE_KEY'

status=0

for workflow in "$WORKFLOW_DIR"/*.yml "$WORKFLOW_DIR"/*.yaml; do
  [[ -f "$workflow" ]] || continue

  echo "Checking $workflow"

  # Require explicit top-level permissions block for least privilege.
  if ! grep -Eq '^permissions:\s*$|^permissions:\s*read-all\s*$' "$workflow"; then
    echo "  ERROR: missing top-level permissions block"
    status=1
  fi

  # Allow either read-all default or explicit contents: read.
  if ! grep -Eq '^permissions:\s*read-all\s*$' "$workflow" && ! grep -Eq '^\s*read-all:\s*$' "$workflow" && ! grep -Eq '^\s*contents:\s*read\s*$' "$workflow"; then
    echo "  ERROR: permissions must include read-all or contents: read"
    status=1
  fi

  # Disallow broad write-all permissions.
  if grep -Eq '^\s*write-all:\s*$' "$workflow"; then
    echo "  ERROR: permissions.write-all is forbidden"
    status=1
  fi

  # Guardrail: block static cloud credential patterns in workflow definitions.
  if grep -Eq "$FORBIDDEN_STATIC_SECRETS_REGEX" "$workflow"; then
    echo "  ERROR: static cloud credential pattern detected (use OIDC + id-token: write)"
    status=1
  fi

  uses_matches="$(grep -E '^\s*-\s*uses:\s*' "$workflow" || true)"
  while IFS= read -r uses_line; do
    [[ -n "$uses_line" ]] || continue

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

    if [[ "$action" =~ $OIDC_ACTIONS_REGEX ]]; then
      if ! grep -Eq '^\s*id-token:\s*write\s*$' "$workflow"; then
        echo "  ERROR: OIDC action requires permissions.id-token: write ($action)"
        status=1
      fi
    fi
  done <<< "$uses_matches"
done

if [[ $status -ne 0 ]]; then
  printf "\nWorkflow governance check failed\n"
  exit $status
fi

printf "\nWorkflow governance check passed\n"
