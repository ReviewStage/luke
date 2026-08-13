#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${LUKE_RELEASE_KEYCHAIN:-}" ]]; then
    printf 'No temporary release keychain was created.\n'
    exit 0
fi

if [[ "$LUKE_RELEASE_KEYCHAIN" != */luke-release-*.keychain-db ]]; then
    printf 'error: refusing to delete an unexpected keychain path: %s\n' \
        "$LUKE_RELEASE_KEYCHAIN" >&2
    exit 1
fi

security delete-keychain "$LUKE_RELEASE_KEYCHAIN" 2>/dev/null || true
printf 'Removed the temporary release keychain.\n'
