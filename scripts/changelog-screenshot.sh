#!/usr/bin/env bash
set -euo pipefail

# Takes one CHANGELOG.md screenshot: a capture of Luke's window, framed on
# macOS's Golden Gate Sunset aerial.
#
#   scripts/changelog-screenshot.sh <out.png> [--from <capture.png>]
#
# With no capture given it opens macOS's window capture, so click Luke's
# window; the capture keeps the window's shadow, which the frame draws over the
# wallpaper. `--from` frames a capture already taken the same way (⇧⌘4, then
# Space, then the window). The framing itself is scripts/lib/frame-screenshot.swift,
# compiled once under the gitignored build directory, and the wallpaper is
# fetched from Apple once and cached beside it.

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
sidecar_require_command xcrun
sidecar_require_command screencapture

if [[ $# -ne 1 && ! ($# -eq 3 && $2 == --from) ]]; then
    printf 'usage: %s <out.png> [--from <capture.png>]\n' "$0" >&2
    exit 2
fi
output=$1
capture=${3:-}

work_root="$SIDECAR_BUILD_ROOT/changelog-screenshot"
framer="$work_root/frame-screenshot"
framer_source="$SCRIPT_DIRECTORY/lib/frame-screenshot.swift"
mkdir -p "$work_root"
if [[ ! -x $framer || $framer_source -nt $framer ]]; then
    xcrun swiftc -O -o "$framer" "$framer_source"
fi

if [[ -z $capture ]]; then
    capture="$work_root/capture.png"
    rm -f -- "$capture"
    printf 'Click Luke'\''s window to capture it.\n' >&2
    screencapture -iWx "$capture"
    if [[ ! -s $capture ]]; then
        printf 'error: no window was captured\n' >&2
        exit 1
    fi
fi

mkdir -p "$(dirname -- "$output")"
"$framer" "$capture" "$output" "$work_root/golden-gate-sunset.png"
printf 'Framed screenshot: %s\n' "$output"
