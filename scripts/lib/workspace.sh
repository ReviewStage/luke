#!/usr/bin/env bash

SIDECAR_SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SIDECAR_REPO_ROOT=$(CDPATH= cd -- "$SIDECAR_SCRIPT_DIRECTORY/../.." && pwd)
SIDECAR_BUILD_ROOT="$SIDECAR_REPO_ROOT/.build"
SIDECAR_SWIFT_BUILD_PATH="$SIDECAR_BUILD_ROOT/swiftpm"
SIDECAR_DERIVED_DATA_PATH="$SIDECAR_BUILD_ROOT/xcode/DerivedData"
SIDECAR_ARTIFACT_ROOT="$SIDECAR_REPO_ROOT/artifacts"
SIDECAR_EVIDENCE_PATH="$SIDECAR_ARTIFACT_ROOT/evidence/app-development.png"
SIDECAR_RESULT_BUNDLE_PATH="$SIDECAR_ARTIFACT_ROOT/test-results/App.xcresult"

export SIDECAR_REPO_ROOT
export SIDECAR_BUILD_ROOT
export SIDECAR_SWIFT_BUILD_PATH
export SIDECAR_DERIVED_DATA_PATH
export SIDECAR_ARTIFACT_ROOT
export SIDECAR_EVIDENCE_PATH
export SIDECAR_RESULT_BUNDLE_PATH

sidecar_require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$1" >&2
        return 1
    fi
}

sidecar_require_macos() {
    if [[ $(uname -s) != Darwin ]]; then
        printf 'error: this command requires macOS and Xcode\n' >&2
        return 1
    fi

    sidecar_require_command xcodebuild
}
