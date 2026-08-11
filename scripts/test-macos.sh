#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
"$SCRIPT_DIRECTORY/check.sh"

cd "$SIDECAR_REPO_ROOT"
pnpm package

PACKAGED_APP=$(find "$SIDECAR_DESKTOP_APP_ROOT/out" -type d -path '*/Luke.app' -print -quit)
if [[ -z "$PACKAGED_APP" ]]; then
    printf 'error: Electron Packager did not produce Luke.app\n' >&2
    exit 1
fi
if [[ ! -x "$PACKAGED_APP/Contents/Resources/mac-screen-geometry" ]]; then
    printf 'error: packaged app is missing the AppKit screen-geometry helper\n' >&2
    exit 1
fi

printf 'Packaged macOS app: %s\n' "$PACKAGED_APP"
