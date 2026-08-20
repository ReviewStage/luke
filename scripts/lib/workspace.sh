#!/usr/bin/env bash

SIDECAR_SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SIDECAR_REPO_ROOT=$(CDPATH= cd -- "$SIDECAR_SCRIPT_DIRECTORY/../.." && pwd)
SIDECAR_DESKTOP_APP_ROOT="$SIDECAR_REPO_ROOT/apps/desktop"
SIDECAR_BUILD_ROOT="$SIDECAR_REPO_ROOT/.build"
SIDECAR_ARTIFACT_ROOT="$SIDECAR_REPO_ROOT/artifacts"
SIDECAR_FIXTURE_SCENARIO=smoke
SIDECAR_EVIDENCE_ROOT="$SIDECAR_ARTIFACT_ROOT/evidence"
SIDECAR_EXPANDED_EVIDENCE_PATH="$SIDECAR_EVIDENCE_ROOT/app-smoke-expanded.png"
SIDECAR_COMPACT_EVIDENCE_PATH="$SIDECAR_EVIDENCE_ROOT/app-smoke-compact.png"
SIDECAR_PEEK_EVIDENCE_PATH="$SIDECAR_EVIDENCE_ROOT/app-smoke-peek.png"
SIDECAR_SLOT_EVIDENCE_PATH="$SIDECAR_EVIDENCE_ROOT/app-smoke-slot.png"
SIDECAR_SPEAKING_EVIDENCE_PATH="$SIDECAR_EVIDENCE_ROOT/app-smoke-speaking.png"
SIDECAR_MUTED_EVIDENCE_PATH="$SIDECAR_EVIDENCE_ROOT/app-smoke-muted.png"
SIDECAR_ELECTRON_BIN="$SIDECAR_DESKTOP_APP_ROOT/node_modules/.bin/electron"

export SIDECAR_REPO_ROOT
export SIDECAR_DESKTOP_APP_ROOT
export SIDECAR_BUILD_ROOT
export SIDECAR_ARTIFACT_ROOT
export SIDECAR_FIXTURE_SCENARIO
export SIDECAR_EVIDENCE_ROOT
export SIDECAR_EXPANDED_EVIDENCE_PATH
export SIDECAR_COMPACT_EVIDENCE_PATH
export SIDECAR_PEEK_EVIDENCE_PATH
export SIDECAR_SLOT_EVIDENCE_PATH
export SIDECAR_SPEAKING_EVIDENCE_PATH
export SIDECAR_MUTED_EVIDENCE_PATH
export SIDECAR_ELECTRON_BIN

sidecar_require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$1" >&2
        return 1
    fi
}

sidecar_wait_for_exit() {
    local deadline=$((SECONDS + $1))
    local pid=$2
    while ((SECONDS < deadline)); do
        if ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        sleep 0.2
    done
    return 1
}

# Electron writes its single-instance lock into the user-data directory and names
# the holder `<hostname>-<pid>`, so the process that blocks a launch identifies
# itself. That is the process to replace even when it belongs to another
# worktree: the lock is keyed on the app name, which every checkout shares.
#
# The app chooses its own name at launch — the product name for a Developer ID
# release, "<product name> Dev" for an unpackaged run, and "<product name> Test"
# for an ad-hoc package, so differently signed builds never share a Keychain
# entry (see apps/desktop/src/main/app-identity.ts). Each name keeps a lock of its own,
# so a caller replacing "the running instance" asks about all three. The product
# name is still derived the way Electron derives its default, from the manifest:
# `productName` when it sets one, the package name otherwise.
sidecar_app_names() {
    local app_name
    if ! app_name=$(cd "$SIDECAR_DESKTOP_APP_ROOT" &&
        node -p 'const manifest = require("./package.json"); manifest.productName ?? manifest.name'); then
        printf 'error: could not read the desktop app name\n' >&2
        return 1
    fi
    printf '%s Dev\n%s Test\n%s\n' "$app_name" "$app_name" "$app_name"
}

sidecar_app_lock_holder_pid() {
    local app_name=$1

    local lock_target
    lock_target=$(readlink "$HOME/Library/Application Support/$app_name/SingletonLock" 2>/dev/null || true)
    # Hostnames contain hyphens, so the pid is what follows the last one.
    local pid=${lock_target##*-}
    if [[ ! $pid =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
        # No lock, or a stale one whose holder is gone: Electron reclaims it.
        return 0
    fi

    # A stale lock can name a pid that has since been reused, so a holder that is
    # not an Electron app is reported rather than signalled.
    local command_line
    command_line=$(ps -o command= -p "$pid" 2>/dev/null || true)
    case $command_line in
    */Electron.app/Contents/MacOS/Electron* | */Luke.app/Contents/MacOS/Luke*)
        printf '%s\n' "$pid"
        ;;
    *)
        printf 'error: pid %s holds the "%s" lock but is not Luke: %s\n' "$pid" "$app_name" "$command_line" >&2
        return 1
        ;;
    esac
}

# Stopping a holder has to wait for it to exit, because the lock is released
# as that process goes away rather than when it is signalled. Development, test,
# and release instances hold separate locks, so all are stopped: a launch means
# "this build owns the screen now", whichever build was there before.
sidecar_stop_running_app() {
    local app_names
    app_names=$(sidecar_app_names) || return 1

    local app_name pid
    while IFS= read -r app_name; do
        pid=$(sidecar_app_lock_holder_pid "$app_name") || return 1
        if [[ -z $pid ]]; then
            continue
        fi

        # The path tells you which checkout the older instance came from.
        printf 'Stopping the running %s instance (pid %s: %s)\n' "$app_name" "$pid" "$(ps -o comm= -p "$pid")"
        kill "$pid" 2>/dev/null || true
        if sidecar_wait_for_exit 5 "$pid"; then
            continue
        fi

        kill -KILL "$pid" 2>/dev/null || true
        if sidecar_wait_for_exit 3 "$pid"; then
            continue
        fi

        printf 'error: the running %s instance did not exit; quit it and retry\n' "$app_name" >&2
        return 1
    done <<<"$app_names"
}

sidecar_require_macos() {
    if [[ $(uname -s) != Darwin ]]; then
        printf 'error: this command requires macOS\n' >&2
        return 1
    fi
}

sidecar_require_node() {
    sidecar_require_command node
    sidecar_require_command pnpm
    if ! node -e '
        const [major, minor] = process.versions.node.split(".").map(Number);
        process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1);
    '; then
        printf 'error: Node.js 22.18 or newer is required (found %s)\n' "$(node --version)" >&2
        return 1
    fi
}

# A script that launches Electron is not useful until the workspace has been
# bootstrapped; running bootstrap here keeps `run.sh` and `evidence.sh` from
# each restating that guard.
sidecar_ensure_dependencies() {
    if [[ ! -x "$SIDECAR_ELECTRON_BIN" ]]; then
        "$SIDECAR_REPO_ROOT/scripts/bootstrap.sh"
    fi
}
