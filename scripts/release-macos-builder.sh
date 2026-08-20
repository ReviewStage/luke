#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
if [[ -z "${LUKE_CODESIGN_IDENTITY:-}" ]]; then
    printf 'error: LUKE_CODESIGN_IDENTITY must name a Developer ID Application identity\n' >&2
    exit 1
fi
if [[ -z "${GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET:-}" ]]; then
    printf 'error: GOOGLE_CALENDAR_OAUTH_CLIENT_SECRET must hold the Google Calendar client secret\n' >&2
    exit 1
fi

"$SCRIPT_DIRECTORY/bootstrap.sh"
"$SCRIPT_DIRECTORY/check.sh"

cd "$SIDECAR_REPO_ROOT"
pnpm --filter @luke/desktop release:builder "$@"
