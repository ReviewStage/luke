#!/usr/bin/env bash

# The Vercel project's Ignored Build Step (Settings > Git), for the whole
# deployment: exits 0, which skips it, when nothing any service builds from
# changed, and 1, which builds it, otherwise. Vercel fails a deployment whose
# step exits anything else, so the project runs it as
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
# The deployed tree is every path the web and dev services install or build
# from. Its workspaces are read from the repository rather than listed here:
# `vercel-deployed-paths.mjs` follows `workspace:` dependencies from each
# service's root in `vercel.json`, the closure pnpm's `--filter <service>...`
# installs, and leaves out what no build reads in them (documents, tests,
# their fixtures and goldens). Beside those it holds the dependency patches,
# the install's own files, the shared compiler options, the documents the web
# app prerenders, `vercel.json`, these two scripts, and the eve services'
# source-map step (`eve-source-maps.sh`). `scripts/preview-address.sh` reads
# the same list, so a skipped commit is known to serve what its nearest built
# ancestor serves.
#
# Note that since the project's Root Directory became the repository root
# (#2876), Vercel's own "not affected" skip sees every push as affecting it,
# so without this step every push of a desktop-only branch built both
# services and woke its branch's Neon compute (2026-10-15).
#
# The comparison is with `VERCEL_GIT_PREVIOUS_SHA`, the commit of this
# branch's last deployment that succeeded, fetched by its sha where the
# shallow clone lacks it (a rebased branch's), so the verdict is that the
# deployed tree is the one already deployed, whatever the commits between.
# A preview with no such commit, because the branch has no deployment yet or
# the commit cannot be fetched, is compared with its merge-base with `main`
# instead, deepening the shallow clone until the two histories meet: a branch
# that changes nothing deployed against `main` serves what production does
# and has nothing to preview. Production, the build of `main` itself, never
# falls back so: with no last deployment to compare with, it builds.
# Every fetch goes to the repository Vercel names in its system environment
# variables (`VERCEL_GIT_PROVIDER`, `VERCEL_GIT_REPO_OWNER`,
# `VERCEL_GIT_REPO_SLUG`), not to `origin`: on 2026-10-20, 50 of 120 sampled
# preview builds printed "could not be fetched" within 5 ms of starting, for
# a commit GitHub still served by its sha, which is a clone with no usable
# `origin` rather than a slow or missing commit. The address is GitHub's
# anonymous one, which answers because the repository is public; were it not,
# the fetch would fail and the step would build. Off Vercel, where the
# variables are unset, the fetch goes to `origin`.
# Every other doubt builds: a deployed tree that cannot be read, a merge-base
# that cannot be found, or a diff that errors exits 1. Note that the script
# sets no `-e` or `-u`, and every path ends in an explicit `exit 0` or
# `exit 1`.

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_BRANCH=main
# Where the fetched `main` is kept, out of the way of any branch of the clone's own.
MAIN_REF=refs/vercel-ignore/main
# How deep the clone is fetched, in turn, for its head and `main` to meet:
# `main` lands about 250 commits a day (2026-10-24), so the last reaches a
# branch cut more than a week ago.
MERGE_BASE_DEPTHS=(200 2000)

ROOT_PATHS=(
    :/patches
    :/package.json
    :/pnpm-lock.yaml
    :/pnpm-workspace.yaml
    :/tsconfig.base.json
    :/CHANGELOG.md
    :/PRIVACY.md
    :/vercel.json
    :/scripts/vercel-ignore.sh
    :/scripts/vercel-deployed-paths.mjs
    :/scripts/eve-source-maps.sh
)

# Fills `DEPLOYED_PATHS` with the deployed tree, or fails where the
# workspaces cannot be read. Note that the list is read a line at a time
# rather than by `mapfile`, which the bash a Mac ships lacks.
read_deployed_paths() {
    local root workspaces line
    root=$(git rev-parse --show-toplevel) || return 1
    workspaces=$(node "$SCRIPT_DIRECTORY/vercel-deployed-paths.mjs" "$root") || return 1
    DEPLOYED_PATHS=()
    while IFS= read -r line; do
        [[ -n $line ]] && DEPLOYED_PATHS+=("$line")
    done <<<"$workspaces"
    DEPLOYED_PATHS+=("${ROOT_PATHS[@]}")
}

if [[ ${1:-} == --paths ]]; then
    read_deployed_paths || exit 1
    printf '%s\n' "${DEPLOYED_PATHS[@]}"
    exit 0
fi

# Where commits are fetched from: the repository Vercel built this deployment
# from, where it names one on GitHub, and `origin` otherwise.
fetch_source() {
    if [[ ${VERCEL_GIT_PROVIDER:-} == github && -n ${VERCEL_GIT_REPO_OWNER:-} && -n ${VERCEL_GIT_REPO_SLUG:-} ]]; then
        printf 'https://github.com/%s/%s.git' "$VERCEL_GIT_REPO_OWNER" "$VERCEL_GIT_REPO_SLUG"
    else
        printf 'origin'
    fi
}

# Runs `git fetch --quiet` with the arguments given within thirty seconds,
# by a watchdog of the shell's own rather than coreutils' `timeout`, which
# macOS lacks. Note that job control (`set -m`) starts the fetch and the
# watchdog each in a process group of its own, so the kill that ends either
# one ends everything it started: the fetch's remote helper and the
# watchdog's `sleep` alike. Neither writes to the step's output.
fetch_within() {
    set -m
    GIT_TERMINAL_PROMPT=0 git fetch --quiet "$@" >/dev/null 2>&1 &
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

# Whether the commit `$1` is in the clone, fetched by its sha from `$2` where not.
have_commit() {
    git cat-file -e "$1^{commit}" 2>/dev/null || fetch_within --depth=1 "$2" "$1"
}

# Prints the merge-base of the head and `main` as fetched from `$1`, deepening
# a shallow clone's head and `main` together until they meet; fails where they
# do not within the deepest fetch. Note that a full clone fetches `main`
# without a depth, because a depth would cut the history it already holds.
merge_base_with_main() {
    local head depth
    head=$(git rev-parse HEAD) || return 1
    if [[ $(git rev-parse --is-shallow-repository) != true ]]; then
        fetch_within "$1" "+refs/heads/$DEFAULT_BRANCH:$MAIN_REF" || return 1
        git merge-base HEAD "$MAIN_REF" 2>/dev/null
        return
    fi
    for depth in "${MERGE_BASE_DEPTHS[@]}"; do
        if fetch_within "--depth=$depth" "$1" "+refs/heads/$DEFAULT_BRANCH:$MAIN_REF" "$head" &&
            git merge-base HEAD "$MAIN_REF" 2>/dev/null; then
            return 0
        fi
    done
    return 1
}

if ! read_deployed_paths; then
    printf 'vercel-ignore: building (the deployed workspaces could not be read)\n'
    exit 1
fi

previous=${VERCEL_GIT_PREVIOUS_SHA:-}
fetch_from=$(fetch_source)
production=false
if [[ ${VERCEL_ENV:-} == production || ${VERCEL_GIT_COMMIT_REF:-} == "$DEFAULT_BRANCH" ]]; then
    production=true
fi

base=
if [[ -n $previous ]]; then
    if have_commit "$previous" "$fetch_from"; then
        base=$previous
    elif [[ $production == true ]]; then
        printf 'vercel-ignore: building (the last deployment, %s, could not be fetched from %s)\n' "$previous" "$fetch_from"
        exit 1
    else
        printf 'vercel-ignore: the last deployment, %s, could not be fetched from %s; comparing with %s\n' "$previous" "$fetch_from" "$DEFAULT_BRANCH"
    fi
elif [[ $production == true ]]; then
    printf 'vercel-ignore: building (no deployment of this branch has succeeded yet)\n'
    exit 1
fi
if [[ -z $base ]]; then
    if ! base=$(merge_base_with_main "$fetch_from"); then
        printf 'vercel-ignore: building (no merge-base with %s could be found from %s)\n' "$DEFAULT_BRANCH" "$fetch_from"
        exit 1
    fi
    printf 'vercel-ignore: comparing with %s, the merge-base with %s\n' "$base" "$DEFAULT_BRANCH"
fi

git diff --quiet "$base" HEAD -- "${DEPLOYED_PATHS[@]}"
status=$?
if ((status == 0)); then
    printf 'vercel-ignore: nothing deployed changed since %s; skipping\n' "$base"
    exit 0
fi
printf 'vercel-ignore: building (git diff against %s exited %s)\n' "$base" "$status"
exit 1
