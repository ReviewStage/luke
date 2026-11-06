#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

APP_FIXTURE_SCENARIO=smoke
APP_EVIDENCE_ROOT="$APP_ARTIFACT_ROOT/evidence"
APP_EXPANDED_EVIDENCE_PATH="$APP_EVIDENCE_ROOT/app-smoke-expanded.png"
APP_TASKS_EVIDENCE_PATH="$APP_EVIDENCE_ROOT/app-smoke-tasks.png"
APP_TASKS_TRANSCRIPT_EVIDENCE_PATH="$APP_EVIDENCE_ROOT/app-smoke-tasks-transcript.png"
APP_TASKS_WORK_EVIDENCE_PATH="$APP_EVIDENCE_ROOT/app-smoke-tasks-work.png"

app_require_macos
app_require_node
app_require_command sips
app_require_command plutil
app_ensure_dependencies

cd "$APP_REPO_ROOT"
pnpm package:dir
PACKAGED_APP=$(node -e "import('./apps/desktop/scripts/package-layout.mjs').then((layout) => process.stdout.write(layout.packagedAppPath(process.cwd())))")
APP_EXECUTABLE="$PACKAGED_APP/Contents/MacOS/Vespin"
if [[ ! -x "$APP_EXECUTABLE" ]]; then
    printf 'error: electron-builder did not produce a runnable app at %s\n' "$PACKAGED_APP" >&2
    exit 1
fi
for helper in mac-microphone-route; do
    if [[ ! -x "$PACKAGED_APP/Contents/Resources/$helper" ]]; then
        printf 'error: packaged app is missing the %s helper\n' "$helper" >&2
        exit 1
    fi
done
BUNDLE_ICON_FILE=$(plutil -extract CFBundleIconFile raw -o - "$PACKAGED_APP/Contents/Info.plist")
PACKAGED_ICON="$PACKAGED_APP/Contents/Resources/$BUNDLE_ICON_FILE"
if [[ ! -f "$PACKAGED_ICON" ]]; then
    printf 'error: packaged app is missing its declared icon: %s\n' "$PACKAGED_ICON" >&2
    exit 1
fi
if ! cmp -s "$PACKAGED_ICON" "$APP_DESKTOP_APP_ROOT/.build/Vespin.icns"; then
    printf 'error: packaged app icon does not match the generated Vespin icon\n' >&2
    exit 1
fi

mkdir -p "$APP_EVIDENCE_ROOT"
rm -f -- "$APP_EVIDENCE_ROOT"/app-smoke-*.png

capture_evidence() {
    local name=$1
    shift
    local profile
    profile=$(mktemp -d "$APP_BUILD_ROOT/evidence-${name}.XXXXXX")
    "$APP_EXECUTABLE" \
        --user-data-dir="$profile" \
        --fixture "$APP_FIXTURE_SCENARIO" \
        "$@"
}

capture_evidence expanded --capture-evidence "$APP_EXPANDED_EVIDENCE_PATH"
capture_evidence tasks --profile tasks --capture-evidence "$APP_TASKS_EVIDENCE_PATH"
capture_evidence tasks-transcript --profile tasks-transcript --capture-evidence "$APP_TASKS_TRANSCRIPT_EVIDENCE_PATH"
capture_evidence tasks-work --profile tasks-work --capture-evidence "$APP_TASKS_WORK_EVIDENCE_PATH"

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

for evidence_path in \
    "$APP_EXPANDED_EVIDENCE_PATH" \
    "$APP_TASKS_EVIDENCE_PATH" \
    "$APP_TASKS_TRANSCRIPT_EVIDENCE_PATH" \
    "$APP_TASKS_WORK_EVIDENCE_PATH"; do
    validate_evidence "$evidence_path" 1280 840
done

printf 'Expanded visual evidence: %s\n' "$APP_EXPANDED_EVIDENCE_PATH"
printf 'Tasks visual evidence: %s\n' "$APP_TASKS_EVIDENCE_PATH"
printf 'Tasks transcript visual evidence: %s\n' "$APP_TASKS_TRANSCRIPT_EVIDENCE_PATH"
printf 'Tasks work visual evidence: %s\n' "$APP_TASKS_WORK_EVIDENCE_PATH"
