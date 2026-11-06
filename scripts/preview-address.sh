#!/usr/bin/env bash
set -euo pipefail

EXIT_NOT_AFFECTED=3
EXIT_NOT_BUILT=4
EXIT_PROTECTED=5
EXIT_NOT_READY=6
EXIT_UNREADABLE=7
EXIT_NOT_REQUESTED=8

SKIPPED_DESCRIPTION="Skipped - Not affected"
IGNORED_STATUS="success: Canceled by Ignored Build Step"
PREVIEW_ENVIRONMENT=Preview
SSO_HOST=vercel.com
SSO_PATH=/sso-api
AGENT_BRANCH_PREFIX=agent/
LEGACY_AGENT_BRANCH_PREFIX=luke/
VERCEL_IGNORE="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/vercel-ignore.sh"

interval_seconds=${PREVIEW_ADDRESS_INTERVAL_SECONDS:-15}
attempts=${PREVIEW_ADDRESS_ATTEMPTS:-80}
quiet_attempts=${PREVIEW_ADDRESS_QUIET_ATTEMPTS:-4}
ancestors=${PREVIEW_ADDRESS_ANCESTORS:-50}
PUSHED_HEADS_PAGE=100

repo=
while (($# > 0)); do
    case $1 in
    --repo)
        repo=$2
        shift 2
        ;;
    *)
        printf 'error: unknown argument: %s\n' "$1" >&2
        exit 2
        ;;
    esac
done

branch=$(git symbolic-ref --quiet --short HEAD || true)
if ! sha=$(git rev-parse HEAD); then
    printf 'UNREADABLE: could not read the head commit\n' >&2
    exit "$EXIT_UNREADABLE"
fi
if [[ -z $repo ]]; then
    if ! repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner); then
        printf 'UNREADABLE: gh could not name the repository\n' >&2
        exit "$EXIT_UNREADABLE"
    fi
fi

read_record() {
    gh api "repos/$repo/deployments?sha=$sha&environment=$PREVIEW_ENVIRONMENT&per_page=10" \
        --jq 'sort_by(.created_at) | reverse | .[0].id // empty'
}

read_status() {
    gh api "repos/$repo/deployments/$1/statuses?per_page=10" \
        --jq 'sort_by(.created_at) | reverse | .[0] | select(. != null) | {state, description: (.description // ""), address: (.environment_url // .target_url // "")}'
}

field() {
    printf '%s' "$1" | jq -r ".$2"
}

protected_by_vercel() {
    local location
    if ! location=$(curl -sS -o /dev/null -w '%{redirect_url}' "$1/"); then
        printf 'UNREADABLE: %s did not answer\n' "$1" >&2
        exit "$EXIT_UNREADABLE"
    fi
    [[ $location == "https://$SSO_HOST$SSO_PATH"* ]]
}

read_preview() {
    local role=$1 attempt record status state description address vercel_status quiet=0
    for ((attempt = 1; attempt <= attempts; attempt++)); do
        if ! record=$(read_record); then
            printf 'UNREADABLE: gh could not read the deployments of %s\n' "$sha" >&2
            exit "$EXIT_UNREADABLE"
        fi
        if [[ -n $record ]]; then
            if ! status=$(read_status "$record"); then
                printf 'UNREADABLE: gh could not read the statuses of record %s\n' "$record" >&2
                exit "$EXIT_UNREADABLE"
            fi
            state=
            description=
            address=
            if [[ -n $status ]]; then
                state=$(field "$status" state)
                description=$(field "$status" description)
                address=$(field "$status" address)
            fi
            case $state in
            success)
                if [[ -z $address ]]; then
                    printf 'NOT_BUILT: record %s ended success without an address\n' "$record" >&2
                    exit "$EXIT_NOT_BUILT"
                fi
                if protected_by_vercel "$address"; then
                    printf 'PROTECTED: %s redirects to Vercel SSO; a Mac cannot sign in through that. Turn Deployment Protection off for Preview in the Vercel project, or point at an unprotected address with --preview URL.\n' "$address" >&2
                    exit "$EXIT_PROTECTED"
                fi
                printf '%s\n' "$address"
                exit 0
                ;;
            failure | error)
                printf 'NOT_BUILT: record %s ended %s: %s\n' "$record" "$state" "$description" >&2
                exit "$EXIT_NOT_BUILT"
                ;;
            inactive)
                if [[ $description == "$SKIPPED_DESCRIPTION" ]]; then
                    printf 'preview: record %s for %s was skipped; nothing it deploys changed\n' "$record" "$sha" >&2
                    return
                fi
                ;;
            esac
            printf 'preview: waiting (record %s is %s)\n' "$record" "${state:-unsettled}" >&2
        elif [[ $role != head ]]; then
            return
        else
            if vercel_status=$(gh api "repos/$repo/commits/$sha/status" \
                --jq '[.statuses[] | select(.context == "Vercel")][0] | select(. != null) | "\(.state): \(.description)"' 2>/dev/null); then
                if [[ -z $vercel_status ]]; then
                    quiet=$((quiet + 1))
                else
                    quiet=0
                fi
            else
                vercel_status="unreadable"
            fi
            if [[ $vercel_status == "$IGNORED_STATUS" ]]; then
                printf 'preview: %s was skipped by the Ignored Build Step; nothing it deploys changed\n' "$sha" >&2
                return
            fi
            if ((quiet >= quiet_attempts)) && [[ $branch == "$AGENT_BRANCH_PREFIX"* || $branch == "$LEGACY_AGENT_BRANCH_PREFIX"* ]]; then
                printf 'NOT_REQUESTED: %s is an agent branch, which builds no preview on a push; ask an agent to build one through the Vercel connection, or use Create Deployment in Vercel, or pass --preview URL\n' "$branch" >&2
                exit "$EXIT_NOT_REQUESTED"
            fi
            printf 'preview: waiting (no record yet for %s; Vercel says %s)\n' "$sha" "${vercel_status:-nothing}" >&2
        fi
        if ((attempt < attempts)); then
            sleep "$interval_seconds"
        fi
    done
    printf 'NOT_READY: no preview for %s settled within %s s\n' "$sha" "$((interval_seconds * attempts))" >&2
    exit "$EXIT_NOT_READY"
}

if ! deployed=$("$VERCEL_IGNORE" --paths); then
    printf 'UNREADABLE: could not read the deployed tree from %s\n' "$VERCEL_IGNORE" >&2
    exit "$EXIT_UNREADABLE"
fi
deployed_paths=()
while IFS= read -r path; do
    deployed_paths+=("$path")
done <<<"$deployed"

read_pushed_heads() {
    gh api "repos/$repo/activity?ref=refs/heads/$branch&per_page=$PUSHED_HEADS_PAGE" \
        --jq '.[] | select(.activity_type == "push" or .activity_type == "force_push" or .activity_type == "branch_creation") | .after'
}

read_records() {
    gh api "repos/$repo/deployments?sha=$sha&environment=$PREVIEW_ENVIRONMENT&per_page=10" \
        --jq 'sort_by(.created_at) | reverse | .[].id'
}

read_earlier_preview() {
    local records record status address
    if ! records=$(read_records); then
        printf 'UNREADABLE: gh could not read the deployments of %s\n' "$sha" >&2
        exit "$EXIT_UNREADABLE"
    fi
    while IFS= read -r record; do
        [[ -n $record ]] || continue
        if ! status=$(read_status "$record"); then
            printf 'UNREADABLE: gh could not read the statuses of record %s\n' "$record" >&2
            exit "$EXIT_UNREADABLE"
        fi
        [[ -n $status && $(field "$status" state) == success ]] || continue
        address=$(field "$status" address)
        [[ -n $address ]] || continue
        if protected_by_vercel "$address"; then
            printf 'PROTECTED: %s redirects to Vercel SSO; a Mac cannot sign in through that. Turn Deployment Protection off for Preview in the Vercel project, or point at an unprotected address with --preview URL.\n' "$address" >&2
            exit "$EXIT_PROTECTED"
        fi
        printf '%s\n' "$address"
        exit 0
    done <<<"$records"
    printf 'preview: no build of %s succeeded; passing over it\n' "$sha" >&2
}

deploys_the_head() {
    if ! git cat-file -e "$1^{commit}" 2>/dev/null &&
        ! GIT_TERMINAL_PROMPT=0 git fetch --quiet --depth=1 origin "$1" >/dev/null 2>&1; then
        printf 'preview: %s could not be fetched; passing over it\n' "$1" >&2
        return 1
    fi
    git diff --quiet "$1" "$head" -- "${deployed_paths[@]}"
}

head=$sha
read_preview head
pushed=
if [[ -n $branch ]] && ! pushed=$(read_pushed_heads); then
    printf 'UNREADABLE: gh could not read the pushes to %s\n' "$branch" >&2
    exit "$EXIT_UNREADABLE"
fi
if [[ -n $pushed ]]; then
    while IFS= read -r candidate; do
        if [[ -z $candidate || $candidate == "$head" || $candidate =~ ^0+$ ]]; then
            continue
        fi
        if deploys_the_head "$candidate"; then
            printf 'preview: %s, an earlier head of %s, deploys what %s does; looking there\n' "$candidate" "$branch" "$head" >&2
            sha=$candidate
            read_earlier_preview
        fi
    done <<<"$pushed"
    sha=$head
fi

walked=0
while true; do
    while true; do
        if ((walked >= ancestors)); then
            printf 'NOT_AFFECTED: no preview of the deployed tree of %s within %s commits; run without --preview, or pass --preview URL\n' "$head" "$ancestors" >&2
            exit "$EXIT_NOT_AFFECTED"
        fi
        if ! parent=$(git rev-parse --verify --quiet "$sha^"); then
            printf 'NOT_AFFECTED: %s has no parent to find a preview on\n' "$sha" >&2
            exit "$EXIT_NOT_AFFECTED"
        fi
        sha=$parent
        walked=$((walked + 1))
        if git diff --quiet "$sha" "$head" -- "${deployed_paths[@]}"; then
            break
        fi
    done
    printf 'preview: %s deploys what %s does; looking there\n' "$sha" "$head" >&2
    read_preview ancestor
done
