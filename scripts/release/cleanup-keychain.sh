#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${APP_RELEASE_KEYCHAIN:-}" ]]; then
    printf 'No temporary release keychain was created.\n'
    exit 0
fi

if [[ "$APP_RELEASE_KEYCHAIN" != */vespin-release-*.keychain-db ]]; then
    printf 'error: refusing to delete an unexpected keychain path: %s\n' \
        "$APP_RELEASE_KEYCHAIN" >&2
    exit 1
fi

security delete-keychain "$APP_RELEASE_KEYCHAIN" 2>/dev/null || true
printf 'Removed the temporary release keychain.\n'
