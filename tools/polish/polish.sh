#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/../../scripts/lib/workspace.sh"

app_require_node
app_ensure_dependencies
cd "$APP_REPO_ROOT"

clients=()
previous=
for argument in "$@"; do
    case $argument in
    --client=*) clients+=("${argument#--client=}") ;;
    esac
    if [[ $previous == --client ]]; then
        clients+=("$argument")
    fi
    previous=$argument
done
drives_desktop=true
if ((${#clients[@]} > 0)) && [[ " ${clients[*]} " != *" desktop "* ]]; then
    drives_desktop=false
fi
if [[ " $* " == *" --help "* ]]; then
    drives_desktop=false
fi

runner=(node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON "$SCRIPT_DIRECTORY/polish-shots.ts")

if [[ $drives_desktop == false ]]; then
    exec "${runner[@]}" "$@"
fi

if [[ $(uname -s) == Darwin ]]; then
    pnpm --filter @repo/desktop build:native
fi
pnpm --filter @repo/desktop build
(cd "$APP_DESKTOP_APP_ROOT" && node node_modules/electron/install.js)
ELECTRON=$(cd "$APP_DESKTOP_APP_ROOT" && node -p 'require("electron")')

if [[ $(uname -s) == Darwin ]]; then
    exec "${runner[@]}" --electron "$ELECTRON" "$@"
fi
app_require_command xvfb-run
exec xvfb-run -a -s "-screen 0 1920x1200x24" "${runner[@]}" --electron "$ELECTRON" "$@"
