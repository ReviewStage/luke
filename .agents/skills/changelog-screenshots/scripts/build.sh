#!/usr/bin/env bash
set -euo pipefail

# build.sh <commit> <staging.patch> -- checks a throwaway worktree out at a
# release commit, applies the shot staging patch, and builds the desktop app.
#
# The worktree is $SHOTS_WORKTREE (default ~/Developer/luke-changelog-shots),
# added from the clone at $LUKE_REPO (default ~/Developer/luke) the first time.
# Every build wipes it, node_modules included, because switching releases over
# an old install leaves packages missing. LUKE_SHOT_PATCH_DIST=0 skips the
# post-build window patches, for the notch era.

commit=${1:?usage: build.sh <commit> <staging.patch>}
patch=${2:?usage: build.sh <commit> <staging.patch>}
repo=${LUKE_REPO:-$HOME/Developer/luke}
worktree=${SHOTS_WORKTREE:-$HOME/Developer/luke-changelog-shots}
here=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

if [[ ! -d $worktree ]]; then
    git -C "$repo" fetch --quiet origin
    git -C "$repo" worktree add --detach "$worktree" "$commit"
fi
# Note that we refuse a directory that is not a worktree of $repo, because the checkout and clean below would wipe whatever it holds.
if [[ $(git -C "$worktree" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) != "$(git -C "$repo" rev-parse --path-format=absolute --git-common-dir)" ||
    $(git -C "$worktree" rev-parse --show-toplevel) == "$(git -C "$repo" rev-parse --show-toplevel)" ]]; then
    printf 'error: %s is not a throwaway worktree of %s\n' "$worktree" "$repo" >&2
    exit 1
fi
cd "$worktree"
git fetch --quiet origin
git checkout --quiet --force --detach "$commit"
git clean -fdqx -e .build
git apply "$patch"
find . -name node_modules -type d -prune -exec rm -rf {} +
pnpm install --frozen-lockfile >/tmp/luke-shots-install.log 2>&1 || { tail -20 /tmp/luke-shots-install.log; exit 1; }
cd apps/desktop
# Note that we let the bundle budget move, because the staging embeds pictures a release build never carries.
# The variable only matters for releases cut before the budget was removed; a later checkout has no gate and ignores it.
(LUKE_UPDATE_BUNDLE_BUDGET=1 pnpm build:native && LUKE_UPDATE_BUNDLE_BUDGET=1 pnpm build) >/tmp/luke-shots-build.log 2>&1 ||
    { tail -30 /tmp/luke-shots-build.log; exit 1; }
# Note that a notch-era build (before 0.7.0) skips the window patches, because it is captured with its own --capture-evidence and its staging isolates its own state.
if [[ ${LUKE_SHOT_PATCH_DIST:-1} == 1 ]]; then
    bash "$here/patch-dist.sh"
fi
git log -1 --oneline
