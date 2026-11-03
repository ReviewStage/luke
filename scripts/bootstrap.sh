#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

app_require_node
if [[ $(uname -s) == Darwin ]]; then
    app_require_command xcrun
fi

mkdir -p "$APP_BUILD_ROOT" "$APP_ARTIFACT_ROOT/evidence"
cd "$APP_REPO_ROOT"

if [[ $(uname -s) == Darwin ]]; then
    pnpm install --frozen-lockfile
else
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile
fi

printf 'Vespin workspace bootstrapped at %s\n' "$APP_REPO_ROOT"
