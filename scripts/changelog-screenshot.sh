#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

app_require_macos
app_require_command xcrun
app_require_command screencapture

usage() {
    printf 'usage: %s <out.png> [--from <capture.png>] [--layout window|top|bleed] [--crop <x,y,width,height>] [--zoom <factor>]\n' "$0" >&2
    exit 2
}
[[ $# -ge 1 ]] || usage
output=$1
shift
capture=
crop=
zoom=
layout=
while [[ $# -gt 0 ]]; do
    case $1 in
        --from) [[ $# -ge 2 ]] || usage; capture=$2; shift 2 ;;
        --crop) [[ $# -ge 2 ]] || usage; crop=$2; shift 2 ;;
        --zoom) [[ $# -ge 2 ]] || usage; zoom=$2; shift 2 ;;
        --layout) [[ $# -ge 2 ]] || usage; layout=$2; shift 2 ;;
        *) usage ;;
    esac
done

work_root="$APP_BUILD_ROOT/changelog-screenshot"
framer="$work_root/frame-screenshot"
framer_source="$SCRIPT_DIRECTORY/lib/frame-screenshot.swift"
mkdir -p "$work_root"
if [[ ! -x $framer || $framer_source -nt $framer ]]; then
    xcrun swiftc -O -o "$framer" "$framer_source"
fi

if [[ -z $capture ]]; then
    capture="$work_root/capture.png"
    rm -f -- "$capture"
    printf 'Click Vespin'\''s window to capture it.\n' >&2
    screencapture -iWx "$capture"
    if [[ ! -s $capture ]]; then
        printf 'error: no window was captured\n' >&2
        exit 1
    fi
fi

mkdir -p "$(dirname -- "$output")"
"$framer" "$capture" "$output" "$work_root/golden-gate-sunset.png" \
    ${layout:+--layout "$layout"} ${crop:+--crop "$crop"} ${zoom:+--zoom "$zoom"}
printf 'Framed screenshot: %s\n' "$output"
