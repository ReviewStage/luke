#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_macos
sidecar_require_node
sidecar_ensure_dependencies

# Running this script means "launch the build I just made", so an already-running
# instance is replaced rather than left in place. `--keep-running` opts out: the
# new launch then quits on startup and only re-asserts the running panel.
# `--preview` points the build at this branch's Vercel Preview instead of
# production, so a web change is tried against the Mac before it merges; an
# address after it (`--preview https://…`) skips the lookup. Every other
# argument is forwarded to Electron.
replace_running_app=true
capture_trace=true
use_preview=false
preview_address=
remaining_arguments=$#
while ((remaining_arguments-- > 0)); do
    argument=$1
    shift
    if [[ $argument == --keep-running ]]; then
        replace_running_app=false
        continue
    fi
    if [[ $argument == --no-trace ]]; then
        capture_trace=false
        continue
    fi
    if [[ $argument == --preview ]]; then
        use_preview=true
        if ((remaining_arguments > 0)) && [[ $1 == https://* ]]; then
            preview_address=$1
            shift
            ((remaining_arguments--))
        fi
        continue
    fi
    set -- "$@" "$argument"
done

# The preview stands in for production through the one development override
# the build honours (`LUKE_ACCOUNT_BASE_URL`, apps/desktop/src/main/bootstrap.ts),
# which the voice socket follows; a packaged build ignores both. The preview's
# Neon branch is its own database, so the account there starts empty, and no
# cron tick runs on a preview.
if [[ $use_preview == true ]]; then
    if [[ -z $preview_address ]]; then
        sidecar_require_command gh
        sidecar_require_command curl
        sidecar_require_command jq
        preview_address=$("$SCRIPT_DIRECTORY/preview-address.sh")
    fi
    export LUKE_ACCOUNT_BASE_URL="${preview_address%/}/api/auth"
    printf 'preview: launching against %s\n' "$preview_address" >&2
fi

# Development runs record the trace of Luke's own agent traffic by default,
# under the gitignored build directory; `pnpm trace:export` turns one file
# into the document unbox-ai opens. `--no-trace` opts a run out, a directory
# already in the environment wins over the default, and the app itself keeps
# the last word: only an unpackaged live run honours the variable at all, so
# fixture runs and packaged builds record nothing whatever this exports.
if [[ $capture_trace == true && -z ${LUKE_TRACE_DIR:-} ]]; then
    export LUKE_TRACE_DIR="$SIDECAR_REPO_ROOT/.build/traces"
fi

if [[ $replace_running_app == true ]]; then
    sidecar_stop_running_app
fi

# Live sessions are the default. Pass `--fixture smoke` for deterministic data;
# the app honours it on its own, so nothing needs injecting here.
cd "$SIDECAR_REPO_ROOT"
exec pnpm start -- "$@"
