#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
sidecar_require_node
sidecar_require_command sips
sidecar_require_command plutil
sidecar_ensure_dependencies

cd "$SIDECAR_REPO_ROOT"
pnpm package:dir
PACKAGED_APP=$(node -e "import('./apps/desktop/scripts/package-layout.mjs').then((layout) => process.stdout.write(layout.packagedAppPath(process.cwd())))")
APP_EXECUTABLE="$PACKAGED_APP/Contents/MacOS/Luke"
if [[ ! -x "$APP_EXECUTABLE" ]]; then
    printf 'error: electron-builder did not produce a runnable app at %s\n' "$PACKAGED_APP" >&2
    exit 1
fi
# The captures below launch the packaged app, so they prove the bundle runs but
# not that electron-builder carried everything into it: a helper, the addon, or
# the icon can be missing from a bundle whose panel still paints.
for helper in mac-screen-geometry mac-talk-key; do
    if [[ ! -x "$PACKAGED_APP/Contents/Resources/$helper" ]]; then
        printf 'error: packaged app is missing the %s helper\n' "$helper" >&2
        exit 1
    fi
done
if [[ ! -f "$PACKAGED_APP/Contents/Resources/mac-stationary-window.node" ]]; then
    printf 'error: packaged app is missing the mac-stationary-window.node addon\n' >&2
    exit 1
fi
BUNDLE_ICON_FILE=$(plutil -extract CFBundleIconFile raw -o - "$PACKAGED_APP/Contents/Info.plist")
PACKAGED_ICON="$PACKAGED_APP/Contents/Resources/$BUNDLE_ICON_FILE"
if [[ ! -f "$PACKAGED_ICON" ]]; then
    printf 'error: packaged app is missing its declared icon: %s\n' "$PACKAGED_ICON" >&2
    exit 1
fi
if ! cmp -s "$PACKAGED_ICON" "$SIDECAR_DESKTOP_APP_ROOT/.build/Luke.icns"; then
    printf 'error: packaged app icon does not match the generated Luke icon\n' >&2
    exit 1
fi

mkdir -p "$SIDECAR_EVIDENCE_ROOT"
rm -f -- "$SIDECAR_EVIDENCE_ROOT"/app-smoke-*.png

capture_evidence() {
    local name=$1
    shift
    local profile
    profile=$(mktemp -d "$SIDECAR_BUILD_ROOT/evidence-${name}.XXXXXX")
    "$APP_EXECUTABLE" \
        --user-data-dir="$profile" \
        --fixture "$SIDECAR_FIXTURE_SCENARIO" \
        "$@"
}

capture_evidence expanded --expanded --capture-evidence "$SIDECAR_EXPANDED_EVIDENCE_PATH"
capture_evidence compact --compact --capture-evidence "$SIDECAR_COMPACT_EVIDENCE_PATH"
capture_evidence peek --compact --peek --capture-evidence "$SIDECAR_PEEK_EVIDENCE_PATH"
capture_evidence slot --expanded --slot --capture-evidence "$SIDECAR_SLOT_EVIDENCE_PATH"
# Luke speaking, peeked: his meter beside his talking face on the left wing
# with the marks laid out flat on the right, and his words captioned under
# the shape. The peek is the narrowest state that lays the whole strip out,
# which is what has to be checked.
capture_evidence speaking --profile speaking --compact --peek --capture-evidence "$SIDECAR_SPEAKING_EVIDENCE_PATH"
# The speaking run with the Mac's output off: the captions are forced on and
# the volume hint stands in its own band below the caption block with its Got
# it button. The state is the profile's own — a capture run reads no system
# volume — so the frame is deterministic like every other.
capture_evidence muted --profile muted --compact --peek --capture-evidence "$SIDECAR_MUTED_EVIDENCE_PATH"
# Both speakers heard at once, the full-duplex frame: Luke's meter beside his
# face on the left wing and the developer's meter in the marks' place on the
# right, both drawn from the profile's staged levels.
capture_evidence duplex --profile duplex --compact --peek --capture-evidence "$SIDECAR_DUPLEX_EVIDENCE_PATH"

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

    local scale_factor=$((actual_width / expected_width))
    if (( scale_factor < 1 || scale_factor > 4 || actual_height != expected_height * scale_factor )); then
        printf 'error: evidence PNG has unexpected dimensions: %s\n' "$evidence_path" >&2
        exit 1
    fi
}

# The window is a stage, not the shape: every window holds the panel's width,
# so a mode change never moves it, and a compact one still holds the peek the
# capsule grows into, the caption block a whole reply is shown in, the inset
# that closes the stack against the shape's bottom edge, and room for a
# spring to overshoot — 38 + 210 + 6 + 40 tall on the pinned housing.
validate_evidence "$SIDECAR_EXPANDED_EVIDENCE_PATH" 700 560
validate_evidence "$SIDECAR_COMPACT_EVIDENCE_PATH" 700 294
validate_evidence "$SIDECAR_PEEK_EVIDENCE_PATH" 700 294
# The slot is drawn in the expanded window, which is why stepping aside for a
# browser costs no resize at all.
validate_evidence "$SIDECAR_SLOT_EVIDENCE_PATH" 700 560
validate_evidence "$SIDECAR_SPEAKING_EVIDENCE_PATH" 700 294
validate_evidence "$SIDECAR_MUTED_EVIDENCE_PATH" 700 294
validate_evidence "$SIDECAR_DUPLEX_EVIDENCE_PATH" 700 294

printf 'Expanded visual evidence: %s\n' "$SIDECAR_EXPANDED_EVIDENCE_PATH"
printf 'Compact visual evidence: %s\n' "$SIDECAR_COMPACT_EVIDENCE_PATH"
printf 'Peek visual evidence: %s\n' "$SIDECAR_PEEK_EVIDENCE_PATH"
printf 'Key slot visual evidence: %s\n' "$SIDECAR_SLOT_EVIDENCE_PATH"
printf 'Speaking visual evidence: %s\n' "$SIDECAR_SPEAKING_EVIDENCE_PATH"
printf 'Muted visual evidence: %s\n' "$SIDECAR_MUTED_EVIDENCE_PATH"
printf 'Duplex visual evidence: %s\n' "$SIDECAR_DUPLEX_EVIDENCE_PATH"
