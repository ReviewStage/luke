#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
"$SCRIPT_DIRECTORY/check.sh"

rm -rf -- "$SIDECAR_RESULT_BUNDLE_PATH"
mkdir -p "$(dirname -- "$SIDECAR_RESULT_BUNDLE_PATH")"

xcodebuild \
    -project "$SIDECAR_REPO_ROOT/Luke.xcodeproj" \
    -scheme Luke \
    -configuration Debug \
    -destination 'platform=macOS' \
    -derivedDataPath "$SIDECAR_DERIVED_DATA_PATH" \
    -resultBundlePath "$SIDECAR_RESULT_BUNDLE_PATH" \
    CODE_SIGNING_ALLOWED=NO \
    test

printf 'macOS test results: %s\n' "$SIDECAR_RESULT_BUNDLE_PATH"
