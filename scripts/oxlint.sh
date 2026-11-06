#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

app_require_node

cd "$APP_REPO_ROOT"
exec pnpm exec oxlint --config .oxlintrc.json --report-unused-disable-directives-severity=error "$@"
