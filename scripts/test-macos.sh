#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
"$SCRIPT_DIRECTORY/check.sh"

cd "$SIDECAR_REPO_ROOT"
pnpm package

PACKAGED_APP=$(node -e "import('./apps/desktop/scripts/package-layout.mjs').then((layout) => process.stdout.write(layout.packagedAppPath(process.cwd())))")
if [[ ! -d "$PACKAGED_APP" ]]; then
    printf 'error: electron-builder did not produce Luke.app at %s\n' "$PACKAGED_APP" >&2
    exit 1
fi
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
PACKAGED_RESOURCES="$PACKAGED_APP/Contents/Resources"
PACKAGED_SQLITE="$PACKAGED_RESOURCES/app.asar.unpacked/node_modules/better-sqlite3"
if [[ ! -f "$PACKAGED_SQLITE/build/Release/better_sqlite3.node" ]]; then
    printf 'error: packaged app is missing the unpacked better-sqlite3 addon\n' >&2
    exit 1
fi
ELECTRON_RUN_AS_NODE=1 "$PACKAGED_APP/Contents/MacOS/Luke" -e '
const path = require("node:path");
const Database = require(path.join(process.argv[1], "app.asar", "node_modules", "better-sqlite3"));
const database = new Database(":memory:");
database.exec("CREATE VIRTUAL TABLE sessions_fts USING fts5(title)");
database.close();
' "$PACKAGED_RESOURCES"
INFO_PLIST="$PACKAGED_APP/Contents/Info.plist"
BUNDLE_ICON_FILE=$(plutil -extract CFBundleIconFile raw -o - "$INFO_PLIST")
PACKAGED_ICON="$PACKAGED_APP/Contents/Resources/$BUNDLE_ICON_FILE"
GENERATED_ICON="$SIDECAR_DESKTOP_APP_ROOT/.build/Luke.icns"
if [[ ! -f "$PACKAGED_ICON" ]]; then
    printf 'error: packaged app is missing its declared icon: %s\n' "$PACKAGED_ICON" >&2
    exit 1
fi
if ! cmp -s "$PACKAGED_ICON" "$GENERATED_ICON"; then
    printf 'error: packaged app icon does not match the generated Luke icon\n' >&2
    exit 1
fi

printf 'Packaged macOS app: %s\n' "$PACKAGED_APP"
