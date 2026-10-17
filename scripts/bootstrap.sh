#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

luke_require_node
if [[ $(uname -s) == Darwin ]]; then
    luke_require_command xcrun
fi

mkdir -p "$LUKE_BUILD_ROOT" "$LUKE_ARTIFACT_ROOT/evidence"
cd "$LUKE_REPO_ROOT"

if [[ $(uname -s) == Darwin ]]; then
    pnpm install --frozen-lockfile
else
    ELECTRON_SKIP_BINARY_DOWNLOAD=1 pnpm install --frozen-lockfile
fi

printf 'Luke workspace bootstrapped at %s\n' "$LUKE_REPO_ROOT"
