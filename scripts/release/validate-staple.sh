#!/usr/bin/env bash
set -euo pipefail

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
