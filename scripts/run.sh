#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos

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

exec env SIDECAR_FIXTURE_MODE=1 "$SIDECAR_APP_EXECUTABLE" --fixture
