#!/usr/bin/env bash
# polish.sh -- builds what the polish capture drives and runs it, under xvfb on Linux and natively on the Mac.
#
#   tools/polish/polish.sh                                # every scene, every client, both themes, three sizes
#   tools/polish/polish.sh --client web --scene settings-account
#   tools/polish/polish.sh --help                         # the runner's flags
#
# The pictures and their contact sheet land under artifacts/polish/app/
# (index.html). Nothing here is a test and no CI job runs it; it is run by
# hand or by an agent, on Linux for layout and once on the Mac for the last
# look, and nothing it writes is committed.
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/../../scripts/lib/workspace.sh"

luke_require_node
luke_ensure_dependencies
cd "$LUKE_REPO_ROOT"

# The clients named by --client; the desktop is driven where none is named or one is it.
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

# The desktop runs as `pnpm start` does: the native helpers on the Mac, then the bundle.
if [[ $(uname -s) == Darwin ]]; then
    pnpm --filter @luke/desktop build:native
fi
pnpm --filter @luke/desktop build
# A Linux install skips Electron's binary (scripts/bootstrap.sh), so it is fetched here.
(cd "$LUKE_DESKTOP_APP_ROOT" && node node_modules/electron/install.js)
ELECTRON=$(cd "$LUKE_DESKTOP_APP_ROOT" && node -p 'require("electron")')

if [[ $(uname -s) == Darwin ]]; then
    exec "${runner[@]}" --electron "$ELECTRON" "$@"
fi
luke_require_command xvfb-run
# A screen larger than the widest window, so no window is cut to fit it.
exec xvfb-run -a -s "-screen 0 1920x1200x24" "${runner[@]}" --electron "$ELECTRON" "$@"
