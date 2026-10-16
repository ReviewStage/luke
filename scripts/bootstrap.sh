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

# The Chromium @luke/ui's browser tests run in, the build its pinned
# `playwright` names, so every machine checks a component in the same
# browser. CI's test job installs it itself, with the system libraries a bare
# Linux runner lacks, so the jobs that never open a browser skip the download.
if [[ -z ${CI:-} ]]; then
    pnpm --filter @luke/ui exec playwright install chromium
fi

printf 'Luke workspace bootstrapped at %s\n' "$LUKE_REPO_ROOT"
