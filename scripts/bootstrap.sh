#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

if ! command -v swift >/dev/null 2>&1 &&
   [[ ${CONDUCTOR_IS_LOCAL:-} == 0 ]] &&
   command -v dnf >/dev/null 2>&1 &&
   command -v sudo >/dev/null 2>&1; then
    sudo dnf install -y swiftlang
fi

sidecar_require_command swift
if [[ $(uname -s) == Darwin ]]; then
    sidecar_require_command xcodebuild
fi

mkdir -p \
    "$SIDECAR_SWIFT_BUILD_PATH" \
    "$SIDECAR_DERIVED_DATA_PATH" \
    "$SIDECAR_ARTIFACT_ROOT/evidence" \
    "$SIDECAR_ARTIFACT_ROOT/test-results"

swift package \
    --package-path "$SIDECAR_REPO_ROOT" \
    --scratch-path "$SIDECAR_SWIFT_BUILD_PATH" \
    resolve

printf 'Sidecar workspace bootstrapped at %s\n' "$SIDECAR_REPO_ROOT"
