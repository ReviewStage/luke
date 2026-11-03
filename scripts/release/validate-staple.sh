#!/usr/bin/env bash
set -euo pipefail

# Validates the notarization ticket stapled to a release artifact. Apple's ticket
# service can drop the lookup for a minute or two after a notarization is accepted
# (the v0.25.1 run lost its connection on the DMG's validate twice, seconds after
# stapling it), so the validate is tried again on the same wait the staple itself
# uses (STAPLE_ATTEMPTS and STAPLE_RETRY_INTERVAL_MS in
# apps/desktop/scripts/release-config.mjs) before the release gives up.

ATTEMPTS=6
RETRY_INTERVAL_SECONDS=30

if [[ "$#" -ne 1 ]]; then
    printf 'usage: %s <artifact>\n' "$0" >&2
    exit 1
fi

for ((attempt = 1; ; attempt++)); do
    if xcrun stapler validate "$1"; then
        exit 0
    fi
    if ((attempt >= ATTEMPTS)); then
        printf 'error: stapler validate failed %d times: %s\n' "$ATTEMPTS" "$1" >&2
        exit 1
    fi
    printf 'stapler validate attempt %d of %d failed; retrying\n' "$attempt" "$ATTEMPTS" >&2
    sleep "$RETRY_INTERVAL_SECONDS"
done
