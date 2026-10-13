#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_node
"$SCRIPT_DIRECTORY/repository-checks.sh"

cd "$SIDECAR_REPO_ROOT"
# Two branches' migrations that do not commute pass every other check and
# fail on the deploy that applies the second, so drizzle-kit reads the
# folders' snapshot graph before anything else runs.
pnpm --filter @sidecar/database check:migrations
pnpm check "$@"
