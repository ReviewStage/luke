#!/usr/bin/env bash
set -uo pipefail

# phone.sh <out.png> <profile> -- serves the staged web app from the shots
# worktree, opens /app.html?fixture=<profile> in Safari on an iPhone
# simulator, and writes the device screen (rounded, alpha-masked) to <out.png>.
#
# The worktree is $SHOTS_WORKTREE (default ~/Developer/luke-changelog-shots),
# checked out at the release with its staging applied and installed (build.sh,
# LUKE_SHOT_PATCH_DIST=0); the web app's fixture switch exists from 0.21.0 on.
# The simulator is $LUKE_SHOT_PHONE (default "iPhone 17"), dark, at 9:41. Its
# first load transforms every module of the panel, so the page is opened twice
# and given over a minute; frame the screen with frame-phone.py.

out=${1:?usage: phone.sh <out.png> <profile>}
profile=${2:?usage: phone.sh <out.png> <profile>}
worktree=${SHOTS_WORKTREE:-$HOME/Developer/luke-changelog-shots}
name=${LUKE_SHOT_PHONE:-iPhone 17}
url="http://127.0.0.1:5199/app.html?fixture=$profile"
device=$(xcrun simctl list devices available | awk -F'[()]' -v name="$name" 'index($0, "    " name " (") == 1 {print $2; exit}')
[[ -n $device ]] || { printf 'error: no simulator named %s\n' "$name" >&2; exit 1; }
mkdir -p "$(dirname -- "$out")"
(cd "$worktree/apps/web" && exec ./node_modules/.bin/vite --host 127.0.0.1 --port 5199 --strictPort >/tmp/luke-phone-vite.log 2>&1) &
vite=$!
# Note that we stop the server on every exit, because a failed capture must not leave it holding the port.
trap 'kill $vite 2>/dev/null || true' EXIT
xcrun simctl boot "$device" 2>/dev/null || true
xcrun simctl bootstatus "$device" -b >/dev/null 2>&1
xcrun simctl ui "$device" appearance dark
xcrun simctl status_bar "$device" override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3
sleep 4
xcrun simctl openurl "$device" "$url"
sleep 50
xcrun simctl openurl "$device" "$url"
sleep 70
xcrun simctl io "$device" screenshot --mask=alpha "$out" >/dev/null
printf '%s\n' "$out"
