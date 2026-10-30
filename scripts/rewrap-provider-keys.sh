#!/usr/bin/env bash
set -euo pipefail

# Moves every account's stored provider key and GitHub token onto the newest
# key-encryption key, the second step of a rotation of
# PROVIDER_KEY_ENCRYPTION_KEYS.
#
#   CRON_SECRET=<the deployment's own> scripts/rewrap-provider-keys.sh https://tryluke.dev
#
# Run it once the new version heads the list on that deployment and the
# deployment has been redeployed with it. The rewrap runs on the deployment
# itself (`packages/service/src/accounts/provider-key-rewrap.ts`), over the ring the
# deployment holds, so the key-encryption keys never leave Vercel; this asks
# for it under the deployment's CRON_SECRET and prints the counts it answers:
# the version moved onto, rows moved, already current, changed meanwhile, and
# unreadable. Run it again until nothing is changed meanwhile; once nothing is
# left on the old version, drop it from the list and redeploy.
# `apps/web/server/README.md`'s "Accounts' own provider keys" is the whole
# rotation.
#
# Note that the bearer is handed to curl on its standard input, so the secret
# never stands in this machine's process list.

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
