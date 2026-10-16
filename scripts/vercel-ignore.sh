#!/usr/bin/env bash
set -uo pipefail

# Vercel's Ignored Build Step, the same for every service: exits 0, which
# skips the service, when nothing any service builds from changed since the
# last deployment of this branch that succeeded, and non-zero, which builds
# it, otherwise. One verdict for all three means a deployment either skips
# whole or builds whole. Vercel refuses a top-level `ignoreCommand` beside
# `services` (observed on #2989), so each service names this script.
#
#   scripts/vercel-ignore.sh           decide, as each service's `ignoreCommand`
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
# and the `git diff HEAD^ HEAD` the services named before this script were
# observed skipping nothing (2026-10-15), so every push of a desktop-only
# branch built all three services and woke its branch's Neon compute.
#
# The base is `VERCEL_GIT_PREVIOUS_SHA`, the commit of this branch's last
# deployment that succeeded, when the clone holds it, so every commit pushed
# since then counts and not the head's alone; otherwise, on a new branch or
# one rebased past it, the head's parent. Every doubt builds: a base git
# cannot read, or a diff that errors, exits non-zero.

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

base=HEAD^
previous=${VERCEL_GIT_PREVIOUS_SHA:-}
if [[ -n $previous ]] && git cat-file -e "$previous^{commit}" 2>/dev/null; then
    base=$previous
fi

git diff --quiet "$base" HEAD -- "${DEPLOYED_PATHS[@]}"
status=$?
if ((status == 0)); then
    printf 'vercel-ignore: nothing deployed changed since %s; skipping\n' "$base"
    exit 0
fi
printf 'vercel-ignore: building (git diff against %s exited %s)\n' "$base" "$status"
exit 1
