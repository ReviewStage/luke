#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_command swift
"$SCRIPT_DIRECTORY/repository-checks.sh"

swift test \
    --package-path "$SIDECAR_REPO_ROOT" \
    --scratch-path "$SIDECAR_SWIFT_BUILD_PATH" \
    --parallel
