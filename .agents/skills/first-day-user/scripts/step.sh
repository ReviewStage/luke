#!/usr/bin/env bash
# step.sh -- hand the driver one step, read from stdin, and print what it answered.
#
#   bash .agents/skills/first-day-user/scripts/step.sh <run-folder> <step-name> [wait-seconds] <<'EOF'
#   await page.goto(origin + "/sign-in"); await shot("01-signed-in"); return page.url();
#   EOF
#
# A step name is used once: the answer of an earlier step of the same name is
# deleted first, so a stale answer is never read as this one's.
set -euo pipefail

RUN=${1:?usage: step.sh <run-folder> <step-name> [wait-seconds]}
NAME=${2:?usage: step.sh <run-folder> <step-name> [wait-seconds]}
WAIT=${3:-120}

rm -f "$RUN/queue/out/$NAME.json"
cat >"$RUN/queue/in/.$NAME.tmp"
mv "$RUN/queue/in/.$NAME.tmp" "$RUN/queue/in/$NAME.js"
for _ in $(seq 1 $((WAIT * 2))); do
    if [[ -f $RUN/queue/out/$NAME.json ]]; then
        cat "$RUN/queue/out/$NAME.json"
        exit 0
    fi
    sleep 0.5
done
printf 'no answer to %s after %ss; is stack.sh still running?\n' "$NAME" "$WAIT" >&2
exit 1
