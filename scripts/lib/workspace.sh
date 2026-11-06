#!/usr/bin/env bash

APP_SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
APP_REPO_ROOT=$(CDPATH= cd -- "$APP_SCRIPT_DIRECTORY/../.." && pwd)
APP_DESKTOP_APP_ROOT="$APP_REPO_ROOT/apps/desktop"
APP_BUILD_ROOT="$APP_REPO_ROOT/.build"
APP_ARTIFACT_ROOT="$APP_REPO_ROOT/artifacts"

app_require_command() {
    if ! command -v "$1" >/dev/null 2>&1; then
        printf 'error: required command not found: %s\n' "$1" >&2
        return 1
    fi
}

app_wait_for_exit() {
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

app_product_name() {
    if ! (cd "$APP_DESKTOP_APP_ROOT" &&
        node -p 'const manifest = require("./package.json"); manifest.productName ?? manifest.name'); then
        printf 'error: could not read the desktop app name\n' >&2
        return 1
    fi
}

app_app_names() {
    local app_name
    app_name=$(app_product_name) || return 1
    printf '%s Dev\n%s Test\n%s\n' "$app_name" "$app_name" "$app_name"
}

APP_INSTANCE_NAME_PATTERN='^[a-z0-9]+(-[a-z0-9]+)*$'
APP_INSTANCE_NAME_MAX_LENGTH=48

app_is_instance_name() {
    ((${#1} <= APP_INSTANCE_NAME_MAX_LENGTH)) && [[ $1 =~ $APP_INSTANCE_NAME_PATTERN ]]
}

app_instance_app_name() {
    local app_name
    app_name=$(app_product_name) || return 1
    printf '%s Dev %s\n' "$app_name" "$1"
}

app_instance_slug() {
    local slug
    slug=$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//')
    slug=${slug:0:APP_INSTANCE_NAME_MAX_LENGTH}
    printf '%s\n' "${slug%-}"
}

app_preview_instance() {
    local address=$1 branch=${2:-}
    local key=$branch
    if [[ -z $key ]]; then
        key=${address#*://}
        key=${key%%/*}
        key=${key%%.*}
    fi
    app_instance_slug "preview-$key"
}

app_app_lock_holder_pid() {
    local app_name=$1

    local lock_target
    lock_target=$(readlink "$HOME/Library/Application Support/$app_name/SingletonLock" 2>/dev/null || true)
    local pid=${lock_target##*-}
    if [[ ! $pid =~ ^[0-9]+$ ]] || ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi

    local command_line
    command_line=$(ps -o command= -p "$pid" 2>/dev/null || true)
    case $command_line in
    */Electron.app/Contents/MacOS/Electron* | */Vespin.app/Contents/MacOS/Vespin*)
        printf '%s\n' "$pid"
        ;;
    *)
        printf 'error: pid %s holds the "%s" lock but is not Vespin: %s\n' "$pid" "$app_name" "$command_line" >&2
        return 1
        ;;
    esac
}

app_stop_running_app() {
    local instance=${1:-} app_names
    if [[ -n $instance ]]; then
        app_names=$(app_instance_app_name "$instance") || return 1
    else
        app_names=$(app_app_names) || return 1
    fi

    local app_name pid
    while IFS= read -r app_name; do
        pid=$(app_app_lock_holder_pid "$app_name") || return 1
        if [[ -z $pid ]]; then
            continue
        fi

        printf 'Stopping the running %s instance (pid %s: %s)\n' "$app_name" "$pid" "$(ps -o comm= -p "$pid")"
        kill "$pid" 2>/dev/null || true
        if app_wait_for_exit 5 "$pid"; then
            continue
        fi

        kill -KILL "$pid" 2>/dev/null || true
        if app_wait_for_exit 3 "$pid"; then
            continue
        fi

        printf 'error: the running %s instance did not exit; quit it and retry\n' "$app_name" >&2
        return 1
    done <<<"$app_names"
}

app_require_macos() {
    if [[ $(uname -s) != Darwin ]]; then
        printf 'error: this command requires macOS\n' >&2
        return 1
    fi
}

app_require_node() {
    app_require_command node
    app_require_command pnpm
    if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
        printf 'error: Node.js 24 or newer is required (found %s)\n' "$(node --version)" >&2
        return 1
    fi
}

app_ensure_dependencies() {
    "$APP_REPO_ROOT/scripts/bootstrap.sh"
}
