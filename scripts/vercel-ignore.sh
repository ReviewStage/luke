#!/usr/bin/env bash

# The Vercel project's Ignored Build Step (Settings > Git), for the whole
# deployment: exits 0, which skips it, when nothing any service builds from
# changed since the last deployment of this branch that succeeded, and 1,
# which builds it, otherwise. Vercel fails a deployment whose step exits
# anything else, so the project runs it as
#
#   [ -f scripts/vercel-ignore.sh ] && bash scripts/vercel-ignore.sh || exit 1
#
# which builds a branch that predates the script. It lives in the project
# rather than in `vercel.json` because Vercel refuses a top-level
# `ignoreCommand` beside `services`, and does not act on one inside a
# service (both observed on #2989).
#
#   scripts/vercel-ignore.sh           decide, as the project's Ignored Build Step
#   scripts/vercel-ignore.sh --paths   print the deployed tree, one pathspec a line
#
# The deployed tree is every path the web, luke and dev services install or
# build from: the three apps, every package (the services' workspace closure
# is all of them bar `host` and `credentials`, which is not worth a list that
# could go stale), the dependency patches, the install's own files, the shared
# compiler options, the documents the web app prerenders, and `vercel.json`
# and this script. `scripts/preview-address.sh` reads the same list, so a
# skipped commit is known to serve what its nearest built ancestor serves.
#
# Note that since the project's Root Directory became the repository root
# (#2876), Vercel's own "not affected" skip sees every push as affecting it,
# so without this step every push of a desktop-only branch built all three
# services and woke its branch's Neon compute (2026-10-15).
#
# The comparison is with `VERCEL_GIT_PREVIOUS_SHA`, the commit of this
# branch's last deployment that succeeded, fetched by its sha where the
# shallow clone lacks it (a rebased branch's), so the verdict is that the
# deployed tree is the one already deployed, whatever the commits between.
# Every doubt builds: a branch with no deployment yet, a commit that cannot
# be fetched, or a diff that errors exits 1. Note that the script sets no
# `-e` or `-u`, and every path ends in an explicit `exit 0` or `exit 1`.

DEPLOYED_PATHS=(
    :/apps/web
    :/apps/luke
    :/apps/dev
    :/packages
    :/patches
    :/package.json
    :/pnpm-lock.yaml
    :/pnpm-workspace.yaml
    :/tsconfig.base.json
    :/CHANGELOG.md
    :/PRIVACY.md
    :/vercel.json
    :/scripts/vercel-ignore.sh
)

if [[ ${1:-} == --paths ]]; then
    printf '%s\n' "${DEPLOYED_PATHS[@]}"
    exit 0
fi

# Fetches the commit `$1` from origin within thirty seconds, by a watchdog of
# the shell's own rather than coreutils' `timeout`, which macOS lacks. Note
# that job control (`set -m`) starts the fetch and the watchdog each in a
# process group of its own, so the kill that ends either one ends everything
# it started: the fetch's remote helper and the watchdog's `sleep` alike.
# Neither writes to the step's output.
fetch_previous() {
    set -m
    GIT_TERMINAL_PROMPT=0 git fetch --quiet --depth=1 origin "$1" >/dev/null 2>&1 &
    local fetching=$!
    (sleep 30 && kill -TERM -- "-$fetching") >/dev/null 2>&1 &
    local watchdog=$!
    set +m
    wait "$fetching"
    local fetched=$?
    kill -TERM -- "-$watchdog" 2>/dev/null
    wait "$watchdog" 2>/dev/null
    return "$fetched"
}

previous=${VERCEL_GIT_PREVIOUS_SHA:-}
if [[ -z $previous ]]; then
    printf 'vercel-ignore: building (no deployment of this branch has succeeded yet)\n'
    exit 1
fi
if ! git cat-file -e "$previous^{commit}" 2>/dev/null && ! fetch_previous "$previous"; then
    printf 'vercel-ignore: building (the last deployment, %s, could not be fetched)\n' "$previous"
    exit 1
fi

git diff --quiet "$previous" HEAD -- "${DEPLOYED_PATHS[@]}"
status=$?
if ((status == 0)); then
    printf 'vercel-ignore: nothing deployed changed since %s; skipping\n' "$previous"
    exit 0
fi
printf 'vercel-ignore: building (git diff against %s exited %s)\n' "$previous" "$status"
exit 1
