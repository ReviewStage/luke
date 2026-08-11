#!/usr/bin/env bash

SIDECAR_SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SIDECAR_REPO_ROOT=$(CDPATH= cd -- "$SIDECAR_SCRIPT_DIRECTORY/../.." && pwd)
SIDECAR_DESKTOP_APP_ROOT="$SIDECAR_REPO_ROOT/apps/desktop"
SIDECAR_CORE_PACKAGE_ROOT="$SIDECAR_REPO_ROOT/packages/sidecar-core"
SIDECAR_BUILD_ROOT="$SIDECAR_REPO_ROOT/.build"
SIDECAR_ARTIFACT_ROOT="$SIDECAR_REPO_ROOT/artifacts"
SIDECAR_FIXTURE_SCENARIO=smoke
SIDECAR_EXPANDED_EVIDENCE_PATH="$SIDECAR_ARTIFACT_ROOT/evidence/app-smoke-expanded.png"
SIDECAR_COMPACT_EVIDENCE_PATH="$SIDECAR_ARTIFACT_ROOT/evidence/app-smoke-compact.png"
SIDECAR_SPEAKING_EVIDENCE_PATH="$SIDECAR_ARTIFACT_ROOT/evidence/app-smoke-speaking.png"
SIDECAR_ELECTRON_BIN="$SIDECAR_DESKTOP_APP_ROOT/node_modules/.bin/electron"

export SIDECAR_REPO_ROOT
export SIDECAR_DESKTOP_APP_ROOT
export SIDECAR_CORE_PACKAGE_ROOT
export SIDECAR_BUILD_ROOT
export SIDECAR_ARTIFACT_ROOT
export SIDECAR_FIXTURE_SCENARIO
export SIDECAR_EXPANDED_EVIDENCE_PATH
export SIDECAR_COMPACT_EVIDENCE_PATH
export SIDECAR_SPEAKING_EVIDENCE_PATH
export SIDECAR_ELECTRON_BIN

sidecar_require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$1" >&2
        return 1
    fi
}

sidecar_require_macos() {
    if [[ $(uname -s) != Darwin ]]; then
        printf 'error: this command requires macOS\n' >&2
        return 1
    fi
}

sidecar_require_node() {
    sidecar_require_command node
    sidecar_require_command pnpm
    if ! node -e '
        const [major, minor] = process.versions.node.split(".").map(Number);
        process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1);
    '; then
        printf 'error: Node.js 22.12 or newer is required (found %s)\n' "$(node --version)" >&2
        return 1
    fi
}
