#!/usr/bin/env bash
# step.sh -- hand the driver one step, read from stdin, and print what it answered.
#
#   bash .agents/skills/first-day-user/scripts/step.sh <run-folder> <step-name> <<'EOF'
#   await page.goto(origin + "/sign-in"); await shot("01-signed-in"); return page.url();
#   EOF
#
# Every step takes a new name: a name already queued, running, or answered is
# refused, so a stale answer is never read as this one's. The driver answers a
# step that runs past its deadline (`driver.cjs`'s STEP_DEADLINE_MS) as timed
# out before this gives up; a step still queued when this gives up is taken
# back, so a retry never runs it twice.
set -euo pipefail

RUN=${1:?usage: step.sh <run-folder> <step-name>}
NAME=${2:?usage: step.sh <run-folder> <step-name>}
WAIT_SECONDS=120

for used in "$RUN/queue/in/$NAME.js" "$RUN/queue/running/$NAME.js" "$RUN/queue/out/$NAME.json"; do
    if [[ -e $used ]]; then
        printf 'step name %s is already used (%s); give the step a new name\n' "$NAME" "$used" >&2
        exit 1
    fi
done
cat >"$RUN/queue/in/.$NAME.tmp"
mv "$RUN/queue/in/.$NAME.tmp" "$RUN/queue/in/$NAME.js"
for _ in $(seq 1 $((WAIT_SECONDS * 2))); do
    if [[ -f $RUN/queue/out/$NAME.json ]]; then
        cat "$RUN/queue/out/$NAME.json"
        exit 0
    fi
    sleep 0.5
done
if rm "$RUN/queue/in/$NAME.js" 2>/dev/null; then
    printf 'step %s never started after %ss and was taken back; is stack.sh still running?\n' "$NAME" "$WAIT_SECONDS" >&2
else
    printf 'no answer to %s after %ss; is stack.sh still running?\n' "$NAME" "$WAIT_SECONDS" >&2
fi
exit 1
