#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
sidecar_require_node
sidecar_require_command sips
if [[ ! -x "$SIDECAR_ELECTRON_BIN" ]]; then
    "$SCRIPT_DIRECTORY/bootstrap.sh"
fi

cd "$SIDECAR_REPO_ROOT"
pnpm package
PACKAGED_APP=$(find "$SIDECAR_DESKTOP_APP_ROOT/out" -type d -path '*/Luke.app' -print -quit)
APP_EXECUTABLE="$PACKAGED_APP/Contents/MacOS/Luke"
if [[ ! -x "$APP_EXECUTABLE" ]]; then
    printf 'error: packaged app executable was not found\n' >&2
    exit 1
fi

mkdir -p "$(dirname -- "$SIDECAR_EXPANDED_EVIDENCE_PATH")"
rm -f -- \
    "$SIDECAR_EXPANDED_EVIDENCE_PATH" \
    "$SIDECAR_COMPACT_EVIDENCE_PATH" \
    "$SIDECAR_SPEAKING_EVIDENCE_PATH" \
    "$SIDECAR_SETTINGS_EVIDENCE_PATH"
EXPANDED_PROFILE=$(mktemp -d "$SIDECAR_BUILD_ROOT/evidence-expanded.XXXXXX")
COMPACT_PROFILE=$(mktemp -d "$SIDECAR_BUILD_ROOT/evidence-compact.XXXXXX")
SPEAKING_PROFILE=$(mktemp -d "$SIDECAR_BUILD_ROOT/evidence-speaking.XXXXXX")
SETTINGS_PROFILE=$(mktemp -d "$SIDECAR_BUILD_ROOT/evidence-settings.XXXXXX")
"$APP_EXECUTABLE" \
    --force-device-scale-factor="$SIDECAR_EVIDENCE_SCALE" \
    --user-data-dir="$EXPANDED_PROFILE" \
    --fixture "$SIDECAR_FIXTURE_SCENARIO" \
    --expanded \
    --capture-evidence "$SIDECAR_EXPANDED_EVIDENCE_PATH"
"$APP_EXECUTABLE" \
    --force-device-scale-factor="$SIDECAR_EVIDENCE_SCALE" \
    --user-data-dir="$COMPACT_PROFILE" \
    --fixture "$SIDECAR_FIXTURE_SCENARIO" \
    --compact \
    --capture-evidence "$SIDECAR_COMPACT_EVIDENCE_PATH"
"$APP_EXECUTABLE" \
    --force-device-scale-factor="$SIDECAR_EVIDENCE_SCALE" \
    --user-data-dir="$SPEAKING_PROFILE" \
    --fixture "$SIDECAR_FIXTURE_SCENARIO" \
    --profile speaking \
    --compact \
    --capture-evidence "$SIDECAR_SPEAKING_EVIDENCE_PATH"
# The settings view holds the credential surface, which the session-list
# screenshots never show. Without it, a change to that surface produces evidence
# that cannot contain the change.
"$APP_EXECUTABLE" \
    --force-device-scale-factor="$SIDECAR_EVIDENCE_SCALE" \
    --user-data-dir="$SETTINGS_PROFILE" \
    --fixture "$SIDECAR_FIXTURE_SCENARIO" \
    --view settings \
    --expanded \
    --capture-evidence "$SIDECAR_SETTINGS_EVIDENCE_PATH"

validate_evidence() {
    local evidence_path=$1
    local expected_width=$2
    local expected_height=$3

    if [[ ! -s "$evidence_path" ]]; then
        printf 'error: evidence PNG was not created: %s\n' "$evidence_path" >&2
        exit 1
    fi

    local png_signature
    png_signature=$(od -An -tx1 -N8 "$evidence_path" | tr -d '[:space:]')
    if [[ "$png_signature" != 89504e470d0a1a0a ]]; then
        printf 'error: evidence output is not a PNG: %s\n' "$evidence_path" >&2
        exit 1
    fi

    local evidence_metadata
    evidence_metadata=$(sips -g pixelWidth -g pixelHeight "$evidence_path")
    local actual_width
    local actual_height
    actual_width=$(awk '/pixelWidth:/ { print $2 }' <<<"$evidence_metadata")
    actual_height=$(awk '/pixelHeight:/ { print $2 }' <<<"$evidence_metadata")
    if (( actual_width % expected_width != 0 )); then
        printf 'error: evidence PNG has unexpected width: %s\n' "$evidence_path" >&2
        exit 1
    fi

    # The scale is asserted rather than merely bounded: a runner that ignored
    # the forced scale factor would otherwise publish evidence at half the
    # resolution a developer's Mac produces, which reads as a blurry screenshot
    # and makes every render differ from its baseline.
    local scale_factor=$((actual_width / expected_width))
    if (( scale_factor != SIDECAR_EVIDENCE_SCALE || actual_height != expected_height * scale_factor )); then
        printf 'error: evidence PNG is %sx%s, expected %sx at %sx%s: %s\n' \
            "$actual_width" "$actual_height" "$SIDECAR_EVIDENCE_SCALE" \
            "$expected_width" "$expected_height" "$evidence_path" >&2
        exit 1
    fi
}

validate_evidence "$SIDECAR_EXPANDED_EVIDENCE_PATH" 620 520
validate_evidence "$SIDECAR_COMPACT_EVIDENCE_PATH" 282 38
validate_evidence "$SIDECAR_SPEAKING_EVIDENCE_PATH" 282 38
validate_evidence "$SIDECAR_SETTINGS_EVIDENCE_PATH" 620 520

printf 'Expanded visual evidence: %s\n' "$SIDECAR_EXPANDED_EVIDENCE_PATH"
printf 'Compact visual evidence: %s\n' "$SIDECAR_COMPACT_EVIDENCE_PATH"
printf 'Speaking visual evidence: %s\n' "$SIDECAR_SPEAKING_EVIDENCE_PATH"
printf 'Settings visual evidence: %s\n' "$SIDECAR_SETTINGS_EVIDENCE_PATH"
