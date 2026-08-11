#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_node
if [[ $(uname -s) == Darwin ]]; then
    sidecar_require_command xcrun
fi

mkdir -p "$SIDECAR_BUILD_ROOT" "$SIDECAR_ARTIFACT_ROOT/evidence"
cd "$SIDECAR_REPO_ROOT"

if [[ $(uname -s) == Darwin ]]; then
    npm ci
else
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
fi

printf 'Sidecar workspace bootstrapped at %s\n' "$SIDECAR_REPO_ROOT"
