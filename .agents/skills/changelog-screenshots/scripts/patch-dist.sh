#!/usr/bin/env bash
set -euo pipefail

# patch-dist.sh -- local-only edits to the built main bundle in $SHOTS_WORKTREE:
# state kept under --user-data-dir, so a Luke already running never holds the
# single-instance lock against the shot, and every window resized to
# $LUKE_SHOT_SIZE and focused a few seconds in, because the traffic lights only
# draw in colour on the key window.

worktree=${SHOTS_WORKTREE:-$HOME/Developer/luke-changelog-shots}
main="$worktree/apps/desktop/dist/main.js"
sed -i '' -E 's/const stateRoot = (import_node_path[0-9]*\.default\.join\([a-z0-9_]+\.getPath\("appData"\), appName\));/const stateRoot = process.argv.find((a) => a.startsWith("--user-data-dir="))?.slice(16) ?? \1;/' "$main"
if ! grep -q 'startsWith("--user-data-dir=")' "$main"; then
    printf 'warning: stateRoot was not patched; quit any running Luke before shooting\n' >&2
fi
sed -i '' '/luke-changelog-focus/d' "$main"
printf '%s\n' ';/* luke-changelog-focus */ { const e = require("electron"); const size = (process.env.LUKE_SHOT_SIZE || "").split("x").map(Number); e.app.whenReady().then(() => setTimeout(() => { e.app.focus({ steal: true }); e.BrowserWindow.getAllWindows().forEach((w) => { if (size.length === 2 && size[0] > 0) { w.setSize(size[0], size[1]); w.center(); } w.focus(); }); }, 3500)); }' >>"$main"
