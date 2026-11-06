#!/usr/bin/env bash

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DEFAULT_BRANCH=main
MAIN_REF=refs/vercel-ignore/main
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
)

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

fetch_source() {
    if [[ ${VERCEL_GIT_PROVIDER:-} == github && -n ${VERCEL_GIT_REPO_OWNER:-} && -n ${VERCEL_GIT_REPO_SLUG:-} ]]; then
        printf 'https://github.com/%s/%s.git' "$VERCEL_GIT_REPO_OWNER" "$VERCEL_GIT_REPO_SLUG"
    else
        printf 'origin'
    fi
}

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

have_commit() {
    git cat-file -e "$1^{commit}" 2>/dev/null || fetch_within --depth=1 "$2" "$1"
}

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
unfetched=false
if [[ -n $previous ]]; then
    if have_commit "$previous" "$fetch_from"; then
        base=$previous
    elif [[ $production == true ]]; then
        printf 'vercel-ignore: building (the last deployment, %s, could not be fetched from %s)\n' "$previous" "$fetch_from"
        exit 1
    else
        printf 'vercel-ignore: the last deployment, %s, could not be fetched from %s; comparing with %s\n' "$previous" "$fetch_from" "$DEFAULT_BRANCH"
        unfetched=true
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
if [[ $unfetched == true ]]; then
    if ! touched=$(git log --format=%H -1 "$base..HEAD" -- "${DEPLOYED_PATHS[@]}"); then
        printf 'vercel-ignore: building (the commits since %s could not be read)\n' "$base"
        exit 1
    fi
    if [[ -n $touched ]]; then
        printf 'vercel-ignore: building (%s, since the merge-base, changed what is deployed)\n' "$touched"
        exit 1
    fi
fi

git diff --quiet "$base" HEAD -- "${DEPLOYED_PATHS[@]}"
status=$?
if ((status == 0)); then
    printf 'vercel-ignore: nothing deployed changed since %s; skipping\n' "$base"
    exit 0
fi
printf 'vercel-ignore: building (git diff against %s exited %s)\n' "$base" "$status"
exit 1
