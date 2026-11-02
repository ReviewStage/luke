#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

luke_require_macos
luke_require_node
luke_ensure_dependencies

# The instance `--demo` launches, the one folder of its profile a run keeps
# (the CLIs its agents downloaded, `@luke/host`'s local-agent-tools.ts), how
# long its local server may take to answer, and the link the app opens once
# signed in: acme's Inbox, by the slug the seed's workspace name takes in a
# fresh database (`@luke/service/demo/demo-world`'s `DEMO_WORKSPACE_NAME`).
DEMO_INSTANCE=demo
DEMO_KEPT_FOLDER=agent-tools
DEMO_SERVER_WAIT_SECONDS=120
DEMO_LINK=vespin://vespin.dev/acme/inbox

# 32 random bytes in standard base64: a secret, or a key of the provider
# keys' ring (`PROVIDER_KEY_ENCRYPTION_KEYS`).
demo_random_key() {
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'
}

# A loopback port nothing listens on now, as the system hands one out.
demo_free_port() {
    node -e 'const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { process.stdout.write(String(server.address().port)); server.close(); })'
}

# Running this script means "launch the build I just made", so an already-running
# instance is replaced rather than left in place. `--keep-running` opts out: the
# new launch then quits on startup and only re-asserts the running panel.
# `--preview` points the build at this branch's Vercel Preview instead of
# production, so a web change is tried against the Mac before it merges; an
# address after it (`--preview https://…`) skips the lookup. `--instance
# <name>` launches a named development instance beside the plain one, with
# its own profile, replacing only its own earlier run; a `--preview` run is
# one without asking, named for its Preview (`luke_preview_instance`).
# `--demo` launches the `demo` instance signed in as Dean on the acme demo
# world, against a hosted service run on this Mac for as long as the app is
# open (see "The demo" below); it takes none of the three flags above. Every
# other argument is forwarded to Electron.
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
        if ((remaining_arguments == 0)) || ! luke_is_instance_name "$1"; then
            printf 'error: --instance takes a name of lower-case letters, digits, and single hyphens, at most %s long\n' \
                "$LUKE_INSTANCE_NAME_MAX_LENGTH" >&2
            exit 2
        fi
        instance=$1
        shift
        ((remaining_arguments--))
        continue
    fi
    set -- "$@" "$argument"
done

# The demo is an instance of its own against a server of its own, and it
# always replaces its own earlier run, whose profile it is about to clear.
if [[ $use_demo == true ]]; then
    if [[ $use_preview == true || -n $instance || $replace_running_app == false ]]; then
        printf 'error: --demo runs its own instance against its own server, so it takes no --preview, --instance, or --keep-running\n' >&2
        exit 2
    fi
    instance=$DEMO_INSTANCE
fi

# The preview stands in for production through the one development override
# the build honours (`LUKE_ACCOUNT_BASE_URL`, apps/desktop/src/main/bootstrap.ts),
# which a packaged build ignores. The preview's
# Neon branch is its own database, so the account there starts empty, and no
# cron tick runs on a preview.
if [[ $use_preview == true ]]; then
    if [[ -z $preview_address ]]; then
        luke_require_command gh
        luke_require_command curl
        luke_require_command jq
        preview_address=$("$SCRIPT_DIRECTORY/preview-address.sh")
    fi
    export LUKE_ACCOUNT_BASE_URL="${preview_address%/}/api/auth"
    if [[ -z $instance ]]; then
        preview_branch=
        if [[ $preview_address_given == false ]]; then
            preview_branch=$(git -C "$LUKE_REPO_ROOT" symbolic-ref --quiet --short HEAD || true)
        fi
        instance=$(luke_preview_instance "$preview_address" "$preview_branch")
    fi
    printf 'preview: launching against %s\n' "$preview_address" >&2
fi

# The instance travels to the app in the environment, which only an unpackaged
# run reads (apps/desktop/src/main/bootstrap.ts); a plain launch clears one
# inherited from the shell, so it is always the plain instance.
if [[ -n $instance ]]; then
    export LUKE_INSTANCE=$instance
    printf 'instance: launching as "%s", beside the plain Vespin Dev\n' "$(luke_instance_app_name "$instance")" >&2
else
    unset LUKE_INSTANCE
fi

if [[ $replace_running_app == true ]]; then
    luke_stop_running_app "$instance"
fi

# Live sessions are the default. Pass `--fixture smoke` for deterministic data;
# the app honours it on its own, so nothing needs injecting here.
cd "$LUKE_REPO_ROOT"
if [[ $use_demo == false ]]; then
    exec pnpm start -- "$@"
fi

# The demo. The hosted service runs on this Mac for as long as the app is
# open: a throwaway Postgres (tools/demo-postgres/demo-postgres.ts, which
# migrates it and runs `auth:seed`), the acme world written into it
# (`demo:seed`), and the local server over it (`local-server`) on a free
# loopback port, which signs the app in as Dean
# (apps/web/server/local-sign-in.ts). The profile is cleared but for the
# CLIs the app's agents downloaded, so with a new database each run starts
# from the same data. The secrets are made for the run, and each reaches
# only the processes that read it: never the terminal, and never the app,
# whose host daemon and its agents inherit its environment. The app is not
# exec'd, so the trap stops the server and the database and deletes the
# run's folder however the run ends.
demo_profile="$HOME/Library/Application Support/$(luke_instance_app_name "$instance")"
if [[ -d $demo_profile ]]; then
    find "$demo_profile" -mindepth 1 -maxdepth 1 ! -name "$DEMO_KEPT_FOLDER" -exec rm -rf -- {} +
fi

demo_claude_token=${LUKE_DEMO_CLAUDE_TOKEN:-}
demo_anthropic_api_key=${LUKE_DEMO_ANTHROPIC_API_KEY:-}
unset LUKE_DEMO_CLAUDE_TOKEN LUKE_DEMO_ANTHROPIC_API_KEY
if [[ -z $demo_claude_token && -z $demo_anthropic_api_key ]]; then
    printf 'demo: neither LUKE_DEMO_CLAUDE_TOKEN nor LUKE_DEMO_ANTHROPIC_API_KEY is set, so Dean has no Claude credential and agents will not run; set one to run them\n' >&2
fi
demo_auth_secret=$(demo_random_key)
demo_key_ring="1:$(demo_random_key)"
demo_cron_secret=$(demo_random_key)

demo_folder=
postgres_pid=
server_pid=
demo_stop() {
    local pid
    for pid in "$server_pid" "$postgres_pid"; do
        if [[ -n $pid ]]; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    if [[ -n $demo_folder ]]; then
        rm -rf -- "$demo_folder"
    fi
}
trap demo_stop EXIT
demo_folder=$(mktemp -d "${TMPDIR:-/tmp}/luke-demo.XXXXXX")

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

# Note that the seed seals Dean's credential under the key ring the server
# opens it with, so the two are handed the one ring.
(
    export DATABASE_URL="$demo_database_url" PROVIDER_KEY_ENCRYPTION_KEYS="$demo_key_ring"
    if [[ -n $demo_claude_token ]]; then
        export LUKE_DEMO_CLAUDE_TOKEN="$demo_claude_token"
    fi
    if [[ -n $demo_anthropic_api_key ]]; then
        export LUKE_DEMO_ANTHROPIC_API_KEY="$demo_anthropic_api_key"
    fi
    exec pnpm --filter @luke/web demo:seed
)

# Note that node runs the server itself rather than `pnpm --filter @luke/web
# local-server`, because a pnpm that hands the run to the version the
# repository pins waits on it without passing a stop on, so the trap's stop
# would never reach the server.
demo_port=$(demo_free_port)
demo_origin="http://127.0.0.1:$demo_port"
(
    export DATABASE_URL="$demo_database_url" DATABASE_URL_UNPOOLED="$demo_database_url" \
        BETTER_AUTH_SECRET="$demo_auth_secret" PROVIDER_KEY_ENCRYPTION_KEYS="$demo_key_ring" \
        CRON_SECRET="$demo_cron_secret" BETTER_AUTH_URL="$demo_origin" LUKE_EVE_ORIGIN="$demo_origin"
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

# Note that the app is handed acme's link, because a cleared profile opens
# the member's own workspace, which the seed leaves empty; the app holds the
# link until it is signed in (`@luke/features/app-links`), and a link among
# the arguments forwarded, the last, opens in its place.
export LUKE_ACCOUNT_BASE_URL="$demo_origin/api/auth"
pnpm start -- "$DEMO_LINK" "$@"
