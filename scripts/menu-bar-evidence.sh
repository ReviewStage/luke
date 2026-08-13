#!/usr/bin/env bash
set -euo pipefail

# Captures Luke's own menu bar item. The status item is drawn by the system, not
# by the renderer — it hands macOS a template image and macOS decides the colour
# — so it cannot be captured through the app the way the panel is: the only way
# to see it is to photograph the menu bar of a running Mac.
#
# Run it with Luke already running (./scripts/run.sh in another terminal). The
# terminal needs Screen Recording permission in System Settings › Privacy &
# Security, which macOS asks for the first time `screencapture` runs.

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
sidecar_require_command screencapture
sidecar_require_command osascript

# The status area sits at the right end of the menu bar, so the capture is
# anchored to the display's right edge. Both are points, which is what
# `screencapture -R` takes; the file itself comes out at the display's scale.
STRIP_WIDTH=${SIDECAR_MENU_BAR_STRIP_WIDTH:-520}
STRIP_HEIGHT=${SIDECAR_MENU_BAR_HEIGHT:-38}

# Finder reports the desktop in points, which is the coordinate space the
# capture rectangle uses — screen resolution would be wrong on a Retina display.
DESKTOP_BOUNDS=$(osascript -e 'tell application "Finder" to get bounds of window of desktop')
DISPLAY_WIDTH=$(awk -F', *' '{print $3}' <<<"$DESKTOP_BOUNDS")
if [[ ! $DISPLAY_WIDTH =~ ^[0-9]+$ ]]; then
    printf 'error: could not read the display width (got: %s)\n' "$DESKTOP_BOUNDS" >&2
    exit 1
fi

mkdir -p "$SIDECAR_EVIDENCE_ROOT"
screencapture -x -o -R"$((DISPLAY_WIDTH - STRIP_WIDTH)),0,$STRIP_WIDTH,$STRIP_HEIGHT" \
    "$SIDECAR_MENU_BAR_EVIDENCE_PATH"

if [[ ! -s $SIDECAR_MENU_BAR_EVIDENCE_PATH ]]; then
    printf 'error: no screenshot was written; grant Screen Recording permission and retry\n' >&2
    exit 1
fi

printf 'Menu bar evidence: %s\n' "$SIDECAR_MENU_BAR_EVIDENCE_PATH"
printf 'Inspect it: the item is the Luke face, drawn in the menu bar ink at the size of the\n'
printf 'items beside it, and its menu offers Settings and Quit.\n'
