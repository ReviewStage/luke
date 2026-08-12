#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
sidecar_require_node
if [[ ! -x "$SIDECAR_ELECTRON_BIN" ]]; then
    "$SCRIPT_DIRECTORY/bootstrap.sh"
fi

# Live sessions are the default. Pass `--fixture smoke` for deterministic data;
# the app honours it on its own, so nothing needs injecting here.
cd "$SIDECAR_REPO_ROOT"
exec pnpm start -- "$@"
