#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
sidecar_require_command sips

xcodebuild \
    -project "$SIDECAR_REPO_ROOT/Luke.xcodeproj" \
    -scheme Luke \
    -configuration Debug \
    -destination 'platform=macOS' \
    -derivedDataPath "$SIDECAR_DERIVED_DATA_PATH" \
    CODE_SIGNING_ALLOWED=NO \
    build

SIDECAR_APP_EXECUTABLE="$SIDECAR_DERIVED_DATA_PATH/Build/Products/Debug/Luke.app/Contents/MacOS/Luke"
if [[ ! -x "$SIDECAR_APP_EXECUTABLE" ]]; then
    printf 'error: built app executable was not found at %s\n' "$SIDECAR_APP_EXECUTABLE" >&2
    exit 1
fi

mkdir -p "$(dirname -- "$SIDECAR_EVIDENCE_PATH")"
rm -f -- "$SIDECAR_EVIDENCE_PATH"
SIDECAR_FIXTURE_MODE=1 "$SIDECAR_APP_EXECUTABLE" \
    --fixture \
    --render-evidence "$SIDECAR_EVIDENCE_PATH"

if [[ ! -s "$SIDECAR_EVIDENCE_PATH" ]]; then
    printf 'error: evidence PNG was not created\n' >&2
    exit 1
fi

PNG_SIGNATURE=$(od -An -tx1 -N8 "$SIDECAR_EVIDENCE_PATH" | tr -d '[:space:]')
if [[ "$PNG_SIGNATURE" != 89504e470d0a1a0a ]]; then
    printf 'error: evidence output is not a PNG\n' >&2
    exit 1
fi

EVIDENCE_METADATA=$(sips -g pixelWidth -g pixelHeight "$SIDECAR_EVIDENCE_PATH")
if ! grep -q 'pixelWidth: 1520' <<<"$EVIDENCE_METADATA" ||
   ! grep -q 'pixelHeight: 1040' <<<"$EVIDENCE_METADATA"; then
    printf 'error: evidence PNG has unexpected dimensions\n' >&2
    exit 1
fi

printf 'Visual evidence: %s\n' "$SIDECAR_EVIDENCE_PATH"
