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
remaining_arguments=$#
while ((remaining_arguments-- > 0)); do
    argument=$1
    shift
    if [[ $argument == --keep-running ]]; then
        replace_running_app=false
        continue
    fi
    set -- "$@" "$argument"
done

if [[ $replace_running_app == true ]]; then
    sidecar_stop_running_app
fi

# Live sessions are the default. Pass `--fixture smoke` for deterministic data;
# the app honours it on its own, so nothing needs injecting here.
cd "$SIDECAR_REPO_ROOT"
exec pnpm start -- "$@"
