#!/usr/bin/env bash
set -euo pipefail

# Carries every plan still kept as the fixed template's fields over to one
# document, and gives every revision kept as fields its text, the step after
# the switch that starts every new plan as one document.
#
#   CRON_SECRET=<the deployment's own> scripts/backfill-plan-documents.sh https://tryluke.dev
#
# Run it once the switch is live on that deployment. The backfill runs on the
# deployment itself (`apps/web/server/hosted/plan-backfill.ts`); this asks for
# it under the deployment's CRON_SECRET and prints the counts it answers:
# plans carried over, revisions given their text, and those left because
# their text would pass the plan's bound. Running it again carries nothing
# more; once it answers zero of all three, nothing is kept as fields.
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
        "$origin/api/maintenance/plan-documents"
printf '\n'
