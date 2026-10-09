#!/usr/bin/env bash
set -euo pipefail

# Prints the address of the Vercel Preview built from one commit, or exits
# without one.
#
#   scripts/preview-address.sh [--sha COMMIT] [--repo OWNER/NAME]
#
# The preview is found the way CI's probe finds it (`apps/web/server/preview-deployment.ts`):
# through the GitHub deployment record Vercel writes for the head commit, since
# a branch alias keeps serving the previous build until the new one is
# promoted. The newest Preview record's newest status is read as one of four
# states: a pending, queued, or in-progress status is waited on; `inactive`
# is waited through unless Vercel's own "Skipped - Not affected" says the
# `ignoreCommand` built nothing; a failure or error exits NOT_BUILT; and
# `success` names the address. A skipped commit serves the same server as an
# earlier one, so the lookup walks back along first parents to the nearest
# commit whose deployed tree matches the head's and that has a record of its
# own: a commit pushed under a later one has none and is passed over rather
# than waited on. The walk exits NOT_AFFECTED once the deployed tree differs,
# since then no preview was ever built from what this commit would serve. That address is then asked
# for one page, because a preview behind Vercel Authentication redirects every
# stranger to `vercel.com/sso-api`, and a Mac's own requests carry no Vercel
# session, so such a preview is PROTECTED and useless to point a build at.
# Every read goes through `gh` and `curl`, so the test puts fakes on PATH.
# Note that the parameters ride in the query string, because `gh api -f`
# turns the call into a POST and GitHub answers 403 to a deployment create.
#
# stdout carries the address alone on success; stderr carries progress.
# Exit codes:
#
#   0  the address was printed
#   3  NOT_AFFECTED: no preview was built from this commit's deployed tree
#   4  NOT_BUILT: the build failed, or ended without an address
#   5  PROTECTED: the preview answers only to a Vercel session
#   6  NOT_READY: no record settled within the wait
#   7  UNREADABLE: gh, git, or curl would not answer

EXIT_NOT_AFFECTED=3
EXIT_NOT_BUILT=4
EXIT_PROTECTED=5
EXIT_NOT_READY=6
EXIT_UNREADABLE=7

# Vercel's own words on a build its ignoreCommand skipped, compared whole.
SKIPPED_DESCRIPTION="Skipped - Not affected"
PREVIEW_ENVIRONMENT=Preview
SSO_HOST=vercel.com
SSO_PATH=/sso-api
# The deployed tree is whatever the web project's ignoreCommand diffs, read
# from the command itself so the two cannot drift apart.
VERCEL_CONFIG="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/../apps/web/vercel.json"

# Twenty minutes by default, on the probe's own observation that a record
# appears within about 25 s of the push and settles 85–115 s later.
interval_seconds=${PREVIEW_ADDRESS_INTERVAL_SECONDS:-15}
attempts=${PREVIEW_ADDRESS_ATTEMPTS:-80}
ancestors=${PREVIEW_ADDRESS_ANCESTORS:-50}

sha=
repo=
while (($# > 0)); do
    case $1 in
    --sha)
        sha=$2
        shift 2
        ;;
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

if [[ -z $sha ]]; then
    if ! sha=$(git rev-parse HEAD); then
        printf 'UNREADABLE: could not read the head commit\n' >&2
        exit "$EXIT_UNREADABLE"
    fi
fi
if [[ -z $repo ]]; then
    if ! repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner); then
        printf 'UNREADABLE: gh could not name the repository\n' >&2
        exit "$EXIT_UNREADABLE"
    fi
fi

# The newest Preview record for the commit, as "id", or nothing.
read_record() {
    gh api "repos/$repo/deployments?sha=$sha&environment=$PREVIEW_ENVIRONMENT&per_page=10" \
        --jq 'sort_by(.created_at) | reverse | .[0].id // empty'
}

# The record's newest status as one JSON object, or nothing. Note that the
# fields are read out of it one at a time, because a `read` of a delimited row
# folds an empty description into the field beside it and `$(...)` drops the
# blank lines a line-per-field answer would end in.
read_status() {
    gh api "repos/$repo/deployments/$1/statuses?per_page=10" \
        --jq 'sort_by(.created_at) | reverse | .[0] | select(. != null) | {state, description: (.description // ""), address: (.environment_url // .target_url // "")}'
}

field() {
    printf '%s' "$1" | jq -r ".$2"
}

# Whether the address redirects a stranger to Vercel's SSO.
protected_by_vercel() {
    local location
    if ! location=$(curl -sS -o /dev/null -w '%{redirect_url}' "$1/"); then
        printf 'UNREADABLE: %s did not answer\n' "$1" >&2
        exit "$EXIT_UNREADABLE"
    fi
    [[ $location == "https://$SSO_HOST$SSO_PATH"* ]]
}

# Prints the address of the preview built from `$sha` and exits, or returns
# when the commit has no build of its own: Vercel skipped it, or it is not
# the head and has no record. Every other ending exits with its own code.
read_preview() {
    local is_head=$1 attempt record status state description address vercel_status
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
        elif [[ $is_head == false ]]; then
            return
        else
            # No record means Vercel has not started the build; its commit status
            # says whether it knows of the commit at all, so a queued build reads
            # as a queue rather than as nothing.
            vercel_status=$(gh api "repos/$repo/commits/$sha/status" \
                --jq '[.statuses[] | select(.context == "Vercel")][0] | select(. != null) | "\(.state): \(.description)"' 2>/dev/null || true)
            printf 'preview: waiting (no record yet for %s; Vercel says %s)\n' "$sha" "${vercel_status:-nothing}" >&2
        fi
        if ((attempt < attempts)); then
            sleep "$interval_seconds"
        fi
    done
    printf 'NOT_READY: no preview for %s settled within %s s\n' "$sha" "$((interval_seconds * attempts))" >&2
    exit "$EXIT_NOT_READY"
}

if ! ignore_command=$(jq -r '.services.web.ignoreCommand' "$VERCEL_CONFIG"); then
    printf 'UNREADABLE: could not read the ignoreCommand in %s\n' "$VERCEL_CONFIG" >&2
    exit "$EXIT_UNREADABLE"
fi
read -ra deployed_paths <<<"${ignore_command#* -- }"

head=$sha
is_head=true
for ((walked = 0; ; walked++)); do
    read_preview "$is_head"
    if ! parent=$(git rev-parse --verify --quiet "$sha^"); then
        printf 'NOT_AFFECTED: %s has no parent to find a preview on\n' "$sha" >&2
        exit "$EXIT_NOT_AFFECTED"
    fi
    if ! git diff --quiet "$parent" "$head" -- "${deployed_paths[@]}"; then
        printf 'NOT_AFFECTED: no preview was built from the deployed tree of %s; run without --preview, or pass --preview URL\n' "$head" >&2
        exit "$EXIT_NOT_AFFECTED"
    fi
    if ((walked >= ancestors)); then
        printf 'NOT_AFFECTED: no preview within %s commits of %s\n' "$ancestors" "$head" >&2
        exit "$EXIT_NOT_AFFECTED"
    fi
    printf 'preview: %s deploys what %s does; looking there\n' "$parent" "$head" >&2
    sha=$parent
    is_head=false
done
