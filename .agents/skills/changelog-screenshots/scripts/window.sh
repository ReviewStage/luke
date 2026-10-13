#!/usr/bin/env bash
set -euo pipefail

# window.sh <out.png> [electron args...] -- runs the staged build in fixture
# mode with the given args (`--profile shot-<name>`), captures its real window
# with shadow and traffic lights, and quits it. Frame the capture afterwards
# with scripts/changelog-screenshot.sh --from.
#
# The capture is retried until it carries the key window's larger shadow,
# because macOS refuses the activation while someone is typing elsewhere: leave
# the Mac alone while a batch runs, or its pictures come out with grey lights.

out=${1:?usage: window.sh <out.png> [electron args...]}
shift
worktree=${SHOTS_WORKTREE:-$HOME/Developer/luke-changelog-shots}
here=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
build=${TMPDIR:-/tmp}/luke-changelog-window-id
if [[ ! -x $build || $here/window-id.swift -nt $build ]]; then
    xcrun swiftc -O -o "$build" "$here/window-id.swift"
fi
export LUKE_SHOT_SIZE=${LUKE_SHOT_SIZE:-1600x1000}
profile=$(mktemp -d /tmp/luke-shot.XXXX)
mkdir -p "$(dirname -- "$out")"
(cd "$worktree/apps/desktop" && ./node_modules/.bin/electron . --user-data-dir="$profile" --fixture smoke "$@" >/tmp/luke-shot-window.log 2>&1 &)
sleep 8
id=0
owner=0
for pid in $(pgrep -f "user-data-dir=$profile"); do
    candidate=$("$build" "$pid")
    if [[ $candidate != 0 ]]; then id=$candidate; owner=$pid; fi
done
if [[ $id == 0 ]]; then
    printf 'error: no window; see /tmp/luke-shot-window.log\n' >&2
    pkill -f "user-data-dir=$profile" || true
    exit 1
fi
expected=$((${LUKE_SHOT_SIZE%x*} * 2))
for attempt in 1 2 3 4 5; do
    osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $owner) to true" >/dev/null 2>&1 || true
    sleep 1.2
    screencapture -l"$id" -x "$out"
    width=$(sips -g pixelWidth "$out" | awk '/pixelWidth/ {print $2}')
    if ((width - expected > 150)); then break; fi
    printf 'attempt %s: the window was not key (%s px wide)\n' "$attempt" "$width" >&2
done
pkill -f "user-data-dir=$profile" || true
sleep 1
rm -rf "$profile"
printf '%s\n' "$out"
