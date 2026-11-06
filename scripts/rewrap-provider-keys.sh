#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
    printf 'usage: CRON_SECRET=… %s <deployment origin>\n' "$0" >&2
    exit 2
fi
if [[ -z "${CRON_SECRET:-}" ]]; then
    printf 'error: CRON_SECRET must name the deployment'"'"'s own secret\n' >&2
    exit 2
fi

origin="${1%/}"
printf 'Authorization: Bearer %s\n' "$CRON_SECRET" |
    curl --fail-with-body --silent --show-error --request POST --header @- \
        "$origin/api/maintenance/provider-keys-rewrap"
printf '\n'
