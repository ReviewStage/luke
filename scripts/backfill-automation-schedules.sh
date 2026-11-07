#!/usr/bin/env bash
set -euo pipefail

# Keeps a Vercel schedule for every scheduled automation saved before
# automations fired from Vercel Schedules, once, after the deploy that moved
# them there.
#
#   CRON_SECRET=<the deployment's own> scripts/backfill-automation-schedules.sh https://vespin.dev
#
# The keeping runs on the deployment itself
# (`packages/service/src/automations/automation-schedules-backfill.ts`), under
# its own token, since a schedule belongs to the environment whose deployment
# keeps it; this asks for it a page at a time under the deployment's
# CRON_SECRET and prints each page's counts: kept, refused by Vercel, and the
# id the next page starts after. It exits 1 once every page is asked if
# Vercel refused any schedule; a page asked again keeps nothing twice, so run
# it again.
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
after=""
refused=0
while :; do
    page=$(printf 'Authorization: Bearer %s\n' "$CRON_SECRET" |
        curl --fail-with-body --silent --show-error --request POST --header @- \
            --get --data-urlencode "after=$after" \
            "$origin/api/maintenance/automation-schedules")
    printf '%s\n' "$page"
    read -r page_refused after < <(printf '%s' "$page" | node -e 'let s="";process.stdin.on("data",(d)=>s+=d).on("end",()=>{const p=JSON.parse(s);process.stdout.write(`${p.refused} ${p.next??""}\n`)})')
    refused=$((refused + page_refused))
    [[ -n "$after" ]] || break
done
if ((refused > 0)); then
    printf 'error: Vercel refused %d schedules; run this again\n' "$refused" >&2
    exit 1
fi
