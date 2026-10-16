#!/usr/bin/env bash

LUKE_SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
LUKE_REPO_ROOT=$(CDPATH= cd -- "$LUKE_SCRIPT_DIRECTORY/../.." && pwd)
LUKE_DESKTOP_APP_ROOT="$LUKE_REPO_ROOT/apps/desktop"
LUKE_BUILD_ROOT="$LUKE_REPO_ROOT/.build"
LUKE_ARTIFACT_ROOT="$LUKE_REPO_ROOT/artifacts"
LUKE_FIXTURE_SCENARIO=smoke
LUKE_EVIDENCE_ROOT="$LUKE_ARTIFACT_ROOT/evidence"
LUKE_EXPANDED_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-expanded.png"
LUKE_SPEAKING_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-speaking.png"
LUKE_MUTED_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-muted.png"
LUKE_DUPLEX_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-duplex.png"
LUKE_TASKS_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-tasks.png"
LUKE_TASKS_BOARD_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-tasks-board.png"
LUKE_TASKS_TRANSCRIPT_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-tasks-transcript.png"
LUKE_TASKS_WORK_EVIDENCE_PATH="$LUKE_EVIDENCE_ROOT/app-smoke-tasks-work.png"
LUKE_ELECTRON_BIN="$LUKE_DESKTOP_APP_ROOT/node_modules/.bin/electron"

export LUKE_REPO_ROOT
export LUKE_DESKTOP_APP_ROOT
export LUKE_BUILD_ROOT
export LUKE_ARTIFACT_ROOT
export LUKE_FIXTURE_SCENARIO
export LUKE_EVIDENCE_ROOT
export LUKE_EXPANDED_EVIDENCE_PATH
export LUKE_SPEAKING_EVIDENCE_PATH
export LUKE_MUTED_EVIDENCE_PATH
export LUKE_DUPLEX_EVIDENCE_PATH
export LUKE_TASKS_EVIDENCE_PATH
export LUKE_TASKS_BOARD_EVIDENCE_PATH
export LUKE_TASKS_TRANSCRIPT_EVIDENCE_PATH
export LUKE_TASKS_WORK_EVIDENCE_PATH
export LUKE_ELECTRON_BIN

luke_require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$1" >&2
        return 1
    fi
}

luke_wait_for_exit() {
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
# entry (see packages/host/src/app-identity.ts). Each name keeps a lock of its own,
# so a caller replacing "the running instance" asks about all three. The product
# name is still derived the way Electron derives its default, from the manifest:
# `productName` when it sets one, the package name otherwise.
luke_product_name() {
    if ! (cd "$LUKE_DESKTOP_APP_ROOT" &&
        node -p 'const manifest = require("./package.json"); manifest.productName ?? manifest.name'); then
        printf 'error: could not read the desktop app name\n' >&2
        return 1
    fi
}

luke_app_names() {
    local app_name
    app_name=$(luke_product_name) || return 1
    printf '%s Dev\n%s Test\n%s\n' "$app_name" "$app_name" "$app_name"
}

# A named development instance (`run.sh --instance <name>`) answers to
# "<product name> Dev <name>", so it has a state directory, a lock, and a
# Keychain entry of its own and runs beside the plain development instance.
# The app refuses a name outside this pattern and runs as the plain instance
# instead, so the script holds names to it first.
LUKE_INSTANCE_NAME_PATTERN='^[a-z0-9]+(-[a-z0-9]+)*$'
LUKE_INSTANCE_NAME_MAX_LENGTH=48

luke_is_instance_name() {
    ((${#1} <= LUKE_INSTANCE_NAME_MAX_LENGTH)) && [[ $1 =~ $LUKE_INSTANCE_NAME_PATTERN ]]
}

luke_instance_app_name() {
    local app_name
    app_name=$(luke_product_name) || return 1
    printf '%s Dev %s\n' "$app_name" "$1"
}

# Folds any text (a branch, a host) into an instance name: lower case, every
# run of other characters one hyphen, cut to length.
luke_instance_slug() {
    local slug
    slug=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
    slug=${slug:0:LUKE_INSTANCE_NAME_MAX_LENGTH}
    printf '%s\n' "${slug%-}"
}

# The instance a `--preview` run gets when it names none: one per Preview, so
# each keeps its own sign-in, since a Preview has its own database and auth
# secret, and a Preview run never touches the plain instance's. A Preview the
# script looked up is keyed to the branch it was built from (passed as the
# second argument), which keeps one profile across that branch's pushes; an
# address given by hand, or a lookup from a detached head, is keyed to the
# address's host.
luke_preview_instance() {
    local address=$1 branch=${2:-}
    local key=$branch
    if [[ -z $key ]]; then
        key=${address#*://}
        key=${key%%/*}
        key=${key%%.*}
    fi
    luke_instance_slug "preview-$key"
}

luke_app_lock_holder_pid() {
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
# "this build owns the screen now", whichever build was there before. A named
# instance, given as the one argument, stops only its own earlier run, and
# the plain launch never stops a named one.
luke_stop_running_app() {
    local instance=${1:-} app_names
    if [[ -n $instance ]]; then
        app_names=$(luke_instance_app_name "$instance") || return 1
    else
        app_names=$(luke_app_names) || return 1
    fi

    local app_name pid
    while IFS= read -r app_name; do
        pid=$(luke_app_lock_holder_pid "$app_name") || return 1
        if [[ -z $pid ]]; then
            continue
        fi

        # The path tells you which checkout the older instance came from.
        printf 'Stopping the running %s instance (pid %s: %s)\n' "$app_name" "$pid" "$(ps -o comm= -p "$pid")"
        kill "$pid" 2>/dev/null || true
        if luke_wait_for_exit 5 "$pid"; then
            continue
        fi

        kill -KILL "$pid" 2>/dev/null || true
        if luke_wait_for_exit 3 "$pid"; then
            continue
        fi

        printf 'error: the running %s instance did not exit; quit it and retry\n' "$app_name" >&2
        return 1
    done <<<"$app_names"
}

luke_require_macos() {
    if [[ $(uname -s) != Darwin ]]; then
        printf 'error: this command requires macOS\n' >&2
        return 1
    fi
}

luke_require_node() {
    luke_require_command node
    luke_require_command pnpm
    if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
        printf 'error: Node.js 24 or newer is required (found %s)\n' "$(node --version)" >&2
        return 1
    fi
}

# A script that launches Electron runs bootstrap first, every time. Note that
# we do not guard on the Electron binary, because it survives a pull that
# changes the lockfile and the launch then runs on stale dependencies; a
# frozen install with nothing to change is quick.
luke_ensure_dependencies() {
    "$LUKE_REPO_ROOT/scripts/bootstrap.sh"
}
