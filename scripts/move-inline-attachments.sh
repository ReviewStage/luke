#!/usr/bin/env bash
set -euo pipefail

# Moves the files developers' lines to coding agents carried inline, as
# base64 inside `messages.parts`, into `attachment` rows beside their
# conversations, and rewrites each part to name its row.
#
#   CRON_SECRET=<the deployment's own> scripts/move-inline-attachments.sh https://tryluke.dev
#   CRON_SECRET=<the deployment's own> scripts/move-inline-attachments.sh --count https://tryluke.dev
#
# The backfill runs on the deployment itself
# (`packages/service/src/maintenance/line-files-backfill.ts`): each POST moves
# batches of 50 rows, each in its own transaction, for about twenty seconds,
# and answers the rows it moved and read and the rows and parts still inline.
# This asks again until nothing remains, printing each answer; a call that
# moves nothing while rows remain is retried three times, five seconds apart,
# since a row a writer holds is passed over, and then it stops and says so, so
# the last line says what remains: zero, or the rows whose files no
# conversation's row may hold, which stay inline. It is safe to stop and run again at any
# point. `--count` moves nothing and prints what remains.
#
# Note that the bearer is handed to curl on its standard input, so the secret
# never stands in this machine's process list.

count=false
if [[ "${1:-}" == "--count" ]]; then
    count=true
    shift
fi
if [[ $# -ne 1 ]]; then
    printf 'usage: CRON_SECRET=… %s [--count] <deployment origin>\n' "$0" >&2
    exit 2
fi
if [[ -z "${CRON_SECRET:-}" ]]; then
    printf 'error: CRON_SECRET must name the deployment'"'"'s own secret\n' >&2
    exit 2
fi

origin="${1%/}"
endpoint="$origin/api/maintenance/inline-attachments"

ask() {
    printf 'Authorization: Bearer %s\n' "$CRON_SECRET" |
        curl --fail-with-body --silent --show-error --request "$1" --header @- "$endpoint"
}

if [[ "$count" == true ]]; then
    ask GET
    printf '\n'
    exit 0
fi

# A call that moves nothing while rows remain may have found them held by a
# writer's short transaction (the batch passes over locked rows), so it is
# asked again a few times, a few seconds apart, before giving up; rows still
# left after that are ones no conversation's row may hold, or held for longer.
idle=0
while :; do
    answer="$(ask POST)"
    printf '%s\n' "$answer"
    if [[ "$answer" == *'"remainingRows":0,'* ]]; then
        break
    fi
    if [[ "$answer" != *'"moved":0,'* ]]; then
        idle=0
        continue
    fi
    idle=$((idle + 1))
    if [[ $idle -ge 3 ]]; then
        printf 'note: rows remain that three calls in a row moved none of; run again later, or see the PR for the rows that stay inline\n' >&2
        break
    fi
    sleep 5
done
