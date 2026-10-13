#!/usr/bin/env bash
set -euo pipefail

# patch-dist.sh -- local-only edits to the built main bundle in $SHOTS_WORKTREE:
# state kept under --user-data-dir, so a Luke already running never holds the
# single-instance lock against the shot, and every window resized to
# $LUKE_SHOT_SIZE and focused a few seconds in, because the traffic lights only
# draw in colour on the key window. $LUKE_SHOT_ZOOM (default 1) makes the
# window that many times larger and zooms its page to match, so the layout is
# the same $LUKE_SHOT_SIZE points drawn with that many times the pixels: a
# close-up's capture, sharp where a crop of a plain one would be enlarged.

worktree=${SHOTS_WORKTREE:-$HOME/Developer/luke-changelog-shots}
main="$worktree/apps/desktop/dist/main.js"
sed -i '' -E 's/const stateRoot = (import_node_path[0-9]*\.default\.join\([a-z0-9_]+\.getPath\("appData"\), appName\));/const stateRoot = process.argv.find((a) => a.startsWith("--user-data-dir="))?.slice(16) ?? \1;/' "$main"
if ! grep -q 'startsWith("--user-data-dir=")' "$main"; then
    printf 'warning: stateRoot was not patched; quit any running Luke before shooting\n' >&2
fi
# Note that we let every window grow past the screen, because macOS clamps a zoomed window's height to the display otherwise.
if ! grep -q 'enableLargerThanScreen: true' "$main"; then
    sed -i '' -E 's/new (import_electron[0-9]*)\.BrowserWindow\(\{/new \1.BrowserWindow({ enableLargerThanScreen: true, /g' "$main"
    sed -i '' -E 's/new (import_electron[0-9]*)\.BrowserWindow\(([A-Za-z_$][A-Za-z_$0-9]*)\)/new \1.BrowserWindow({ ...\2, enableLargerThanScreen: true })/g' "$main"
fi
sed -i '' '/luke-changelog-focus/d' "$main"
printf '%s\n' ';/* luke-changelog-focus */ { const e = require("electron"); const size = (process.env.LUKE_SHOT_SIZE || "").split("x").map(Number); e.app.whenReady().then(() => setTimeout(() => { e.app.focus({ steal: true }); const zoom = Number(process.env.LUKE_SHOT_ZOOM || 1); e.BrowserWindow.getAllWindows().forEach((w) => { if (size.length === 2 && size[0] > 0) { w.setSize(Math.round(size[0] * zoom), Math.round(size[1] * zoom)); w.webContents.setZoomFactor(zoom); w.center(); } w.focus(); }); }, 3500)); }' >>"$main"
