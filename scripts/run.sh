#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

app_require_macos
app_require_node
app_ensure_dependencies

DEMO_INSTANCE=demo
DEMO_KEPT_FOLDER=agent-tools
DEMO_HOST_HOME=host-home
DEMO_SERVER_WAIT_SECONDS=120
DEMO_LINK=vespin://vespin.dev/acme/inbox

demo_random_key() {
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'
}

demo_free_port() {
    node -e 'const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { process.stdout.write(String(server.address().port)); server.close(); })'
}

replace_running_app=true
use_preview=false
use_demo=false
preview_address=
preview_address_given=false
instance=
remaining_arguments=$#
while ((remaining_arguments-- > 0)); do
    argument=$1
    shift
    if [[ $argument == --keep-running ]]; then
        replace_running_app=false
        continue
    fi
    if [[ $argument == --preview ]]; then
        use_preview=true
        if ((remaining_arguments > 0)) && [[ $1 == https://* ]]; then
            preview_address=$1
            preview_address_given=true
            shift
            ((remaining_arguments--))
        fi
        continue
    fi
    if [[ $argument == --demo ]]; then
        use_demo=true
        continue
    fi
    if [[ $argument == --instance ]]; then
        if ((remaining_arguments == 0)) || ! app_is_instance_name "$1"; then
            printf 'error: --instance takes a name of lower-case letters, digits, and single hyphens, at most %s long\n' \
                "$APP_INSTANCE_NAME_MAX_LENGTH" >&2
            exit 2
        fi
        instance=$1
        shift
        ((remaining_arguments--))
        continue
    fi
    set -- "$@" "$argument"
done

if [[ $use_demo == true ]]; then
    if [[ $use_preview == true || -n $instance || $replace_running_app == false ]]; then
        printf 'error: --demo runs its own instance against its own server, so it takes no --preview, --instance, or --keep-running\n' >&2
        exit 2
    fi
    instance=$DEMO_INSTANCE
fi

if [[ $use_preview == true ]]; then
    if [[ -z $preview_address ]]; then
        app_require_command gh
        app_require_command curl
        app_require_command jq
        preview_address=$("$SCRIPT_DIRECTORY/preview-address.sh")
    fi
    export APP_ACCOUNT_BASE_URL="${preview_address%/}/api/auth"
    if [[ -z $instance ]]; then
        preview_branch=
        if [[ $preview_address_given == false ]]; then
            preview_branch=$(git -C "$APP_REPO_ROOT" symbolic-ref --quiet --short HEAD || true)
        fi
        instance=$(app_preview_instance "$preview_address" "$preview_branch")
    fi
    printf 'preview: launching against %s\n' "$preview_address" >&2
fi

if [[ -n $instance ]]; then
    export APP_INSTANCE=$instance
    printf 'instance: launching as "%s", beside the plain Vespin Dev\n' "$(app_instance_app_name "$instance")" >&2
else
    unset APP_INSTANCE
fi

if [[ $replace_running_app == true ]]; then
    app_stop_running_app "$instance"
fi

cd "$APP_REPO_ROOT"
if [[ $use_demo == false ]]; then
    exec pnpm start -- "$@"
fi

demo_profile="$HOME/Library/Application Support/$(app_instance_app_name "$instance")"
if [[ -d $demo_profile ]]; then
    find "$demo_profile" -mindepth 1 -maxdepth 1 ! -name "$DEMO_KEPT_FOLDER" -exec rm -rf -- {} +
fi

unset APP_DEMO_CLAUDE_TOKEN APP_DEMO_ANTHROPIC_API_KEY
demo_claude_token=
demo_anthropic_api_key=
demo_credential_source=
if [[ -n ${CLAUDE_CODE_OAUTH_TOKEN:-} ]]; then
    demo_claude_token=$CLAUDE_CODE_OAUTH_TOKEN
    demo_credential_source=CLAUDE_CODE_OAUTH_TOKEN
elif [[ -n ${ANTHROPIC_API_KEY:-} ]]; then
    demo_anthropic_api_key=$ANTHROPIC_API_KEY
    demo_credential_source=ANTHROPIC_API_KEY
fi
if [[ -n $demo_credential_source ]]; then
    printf "demo: agents get the Claude credential in %s\n" "$demo_credential_source" >&2
else
    printf 'demo: neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set, so agents will not run; set one to run them\n' >&2
fi
demo_auth_secret=$(demo_random_key)
demo_key_ring="1:$(demo_random_key)"
demo_cron_secret=$(demo_random_key)

demo_folder=
postgres_pid=
server_pid=
host_pid=
demo_stop() {
    local pid
    for pid in "$host_pid" "$server_pid" "$postgres_pid"; do
        if [[ -n $pid ]]; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    if [[ -n $host_pid ]]; then
        rm -rf -- "$demo_profile/${DEMO_HOST_HOME:?}"
    fi
    if [[ -n $demo_folder ]]; then
        rm -rf -- "$demo_folder"
    fi
}
trap demo_stop EXIT
demo_folder=$(mktemp -d "${TMPDIR:-/tmp}/app-demo.XXXXXX")

node tools/demo-postgres/demo-postgres.ts --url-file "$demo_folder/database-url" &
postgres_pid=$!
until [[ -s $demo_folder/database-url ]]; do
    if ! kill -0 "$postgres_pid" 2>/dev/null; then
        printf 'error: the demo database did not start\n' >&2
        exit 1
    fi
    sleep 0.2
done
demo_database_url=$(<"$demo_folder/database-url")

demo_port=$(demo_free_port)
demo_origin="http://127.0.0.1:$demo_port"
(
    export DATABASE_URL="$demo_database_url" PROVIDER_KEY_ENCRYPTION_KEYS="$demo_key_ring" \
        APP_DEMO_HOST_STATE="$demo_profile" APP_DEMO_SERVICE_ORIGIN="$demo_origin"
    if [[ -n $demo_claude_token ]]; then
        export APP_DEMO_CLAUDE_TOKEN="$demo_claude_token"
    fi
    if [[ -n $demo_anthropic_api_key ]]; then
        export APP_DEMO_ANTHROPIC_API_KEY="$demo_anthropic_api_key"
    fi
    exec pnpm --filter @repo/web demo:seed
)

(
    export DATABASE_URL="$demo_database_url" DATABASE_URL_UNPOOLED="$demo_database_url" \
        BETTER_AUTH_SECRET="$demo_auth_secret" PROVIDER_KEY_ENCRYPTION_KEYS="$demo_key_ring" \
        CRON_SECRET="$demo_cron_secret" BETTER_AUTH_URL="$demo_origin" APP_DEPLOYMENT_ORIGIN="$demo_origin"
    cd apps/web
    exec node --import tsx scripts/local-server.ts --port "$demo_port"
) >"$demo_folder/server.log" 2>&1 &
server_pid=$!
demo_deadline=$((SECONDS + DEMO_SERVER_WAIT_SECONDS))
until curl --silent --max-time 5 --output /dev/null "$demo_origin/api/auth/ok"; do
    if ! kill -0 "$server_pid" 2>/dev/null || ((SECONDS >= demo_deadline)); then
        printf 'error: the demo server did not answer at %s; it printed:\n' "$demo_origin" >&2
        cat "$demo_folder/server.log" >&2
        exit 1
    fi
    sleep 0.5
done
printf 'demo: serving %s, its log at %s\n' "$demo_origin" "$demo_folder/server.log" >&2

pnpm --filter @repo/host-daemon --filter @repo/agent-runner build >"$demo_folder/host-build.log" 2>&1 || {
    printf 'error: the demo host did not build; it printed:\n' >&2
    cat "$demo_folder/host-build.log" >&2
    exit 1
}
mkdir -p "$demo_folder/host/lib" "$demo_profile/$DEMO_HOST_HOME"
cp apps/host/dist/vespin-host.mjs packages/agent-runner/dist/agent-runner.mjs "$demo_folder/host/lib/"
env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY APP_HOST_STATE_ROOT="$demo_profile" \
    HOME="$demo_profile/$DEMO_HOST_HOME" ZDOTDIR="${ZDOTDIR:-$HOME}" \
    node "$demo_folder/host/lib/vespin-host.mjs" run >"$demo_folder/host.log" 2>&1 &
host_pid=$!
printf "demo: running this Mac's host, its log at %s\n" "$demo_folder/host.log" >&2

export APP_ACCOUNT_BASE_URL="$demo_origin/api/auth"
pnpm start -- "$DEMO_LINK" "$@"
