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
# new launch then quits on startup and only re-asserts the running panel. Every
# other argument is forwarded to Electron.
replace_running_app=true
capture_trace=true
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
    set -- "$@" "$argument"
done

# Development runs record the trace of Luke's own agent traffic by default,
# under the gitignored build directory; `pnpm trace:export` turns one file
# into the document unbox-ai opens. `--no-trace` opts a run out, a directory
# already in the environment wins over the default, and the app itself keeps
# the last word: only an unpackaged live run honours the variable at all, so
# fixture runs and packaged builds record nothing whatever this exports.
if [[ $capture_trace == true && -z ${LUKE_TRACE_DIR:-} ]]; then
    export LUKE_TRACE_DIR="$SIDECAR_REPO_ROOT/.build/traces"
fi

# Dev control channel: the app listens here for session-state and capture-
# override commands from `pnpm dev:emit`. A pre-existing value wins so a
# developer can point the CLI at a custom path. Only an unpackaged live run
# honours the variable at all, so a fixture run or a packaged build ignores
# it however this is set.
if [[ -z ${LUKE_DEV_HARNESS_SOCK:-} ]]; then
    export LUKE_DEV_HARNESS_SOCK="$SIDECAR_REPO_ROOT/.build/dev-harness.sock"
fi

if [[ $replace_running_app == true ]]; then
    sidecar_stop_running_app
fi

# Live sessions are the default. Pass `--fixture smoke` for deterministic data;
# the app honours it on its own, so nothing needs injecting here.
cd "$SIDECAR_REPO_ROOT"
exec pnpm start -- "$@"
