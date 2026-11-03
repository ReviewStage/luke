#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

luke_require_macos
luke_require_node
luke_ensure_dependencies

# The instance `--demo` launches, the one folder of its profile a run keeps
# (the CLIs the run's host fetched for its agents, `@luke/host`'s
# local-agent-tools.ts), how long its local server may take to answer, and
# the link the app opens once signed in: acme's Inbox, by the slug the
# seed's workspace name takes in a fresh database
# (`@luke/service/demo/demo-world`'s `DEMO_WORKSPACE_NAME`).
DEMO_INSTANCE=demo
DEMO_KEPT_FOLDER=agent-tools
DEMO_SERVER_WAIT_SECONDS=120
DEMO_LINK=vespin://vespin.dev/acme/inbox

# The host's record of the agents whose folders it made, an empty file named
# for each (`OWNED_FOLDER` in packages/host/src/local-agent-state.ts), and
# where every host of this Mac makes them, under the home
# (`DEVICE_AGENT_FOLDER.ROOT` in packages/features/src/device-agent-wire.ts).
DEMO_OWNED_AGENTS=owned-agents
DEMO_AGENTS_FOLDER=.vespin/agents

# 32 random bytes in standard base64: a secret, or a key of the provider
# keys' ring (`PROVIDER_KEY_ENCRYPTION_KEYS`).
demo_random_key() {
    node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'
}

# A loopback port nothing listens on now, as the system hands one out.
demo_free_port() {
    node -e 'const server = require("node:net").createServer(); server.listen(0, "127.0.0.1", () => { process.stdout.write(String(server.address().port)); server.close(); })'
}

# The folders of the agents the host with the state given made, removed, as
# `vespin-host uninstall` removes its own (apps/host/scripts/vespin-host.sh), so
# no other install's agent beside them in the home's folder is touched. An
# entry that is not an agent's id is passed over.
demo_agents_removed() {
    local owned id
    for owned in "$1/$DEMO_OWNED_AGENTS"/*; do
        id=${owned##*/}
        if [[ -e $owned && $id =~ ^[0-9a-f-]+$ ]]; then
            rm -rf -- "${HOME:?}/$DEMO_AGENTS_FOLDER/$id"
        fi
    done
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
# open (see "The demo" below); it takes none of the three flags above. Dean's
# agents run on the Claude credential this shell already holds,
# `CLAUDE_CODE_OAUTH_TOKEN` or else `ANTHROPIC_API_KEY`, so there is nothing
# to set; with neither, they do not run. Every other argument is forwarded
# to Electron.
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
# the build honours (`APP_ACCOUNT_BASE_URL`, apps/desktop/src/main/bootstrap.ts),
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
    export APP_ACCOUNT_BASE_URL="${preview_address%/}/api/auth"
    if [[ -z $instance ]]; then
        preview_branch=
        if [[ $preview_address_given == false ]]; then
            preview_branch=$(git -C "$APP_REPO_ROOT" symbolic-ref --quiet --short HEAD || true)
        fi
        instance=$(luke_preview_instance "$preview_address" "$preview_branch")
    fi
    printf 'preview: launching against %s\n' "$preview_address" >&2
fi

# The instance travels to the app in the environment, which only an unpackaged
# run reads (apps/desktop/src/main/bootstrap.ts); a plain launch clears one
# inherited from the shell, so it is always the plain instance.
if [[ -n $instance ]]; then
    export APP_INSTANCE=$instance
    printf 'instance: launching as "%s", beside the plain Vespin Dev\n' "$(luke_instance_app_name "$instance")" >&2
else
    unset APP_INSTANCE
fi

if [[ $replace_running_app == true ]]; then
    luke_stop_running_app "$instance"
fi

# Live sessions are the default. Pass `--fixture smoke` for deterministic data;
# the app honours it on its own, so nothing needs injecting here.
cd "$APP_REPO_ROOT"
if [[ $use_demo == false ]]; then
    exec pnpm start -- "$@"
fi

# The demo. The hosted service runs on this Mac for as long as the app is
# open: a throwaway Postgres (tools/demo-postgres/demo-postgres.ts, which
# migrates it and runs `auth:seed`), the acme world written into it
# (`demo:seed`), and the local server over it (`local-server`) on a free
# loopback port, which signs the app in as Dean
# (apps/web/server/local-sign-in.ts). Dean's agents run on a host of the
# run's own on this Mac: `vespin-host run` built from this checkout, its state
# the demo profile, enrolled by the seed as Dean's with every task running
# on it. So neither it nor the app, for which Dean's Bring your own host
# stays off, touches the Mac's own host (~/.local/state/luke-host).
# The profile is cleared but for the CLIs that host fetched, and the
# folders of the agents it ran go with it, so with a new database each run
# starts from the same data. The secrets are made for the run, and each
# reaches only the processes that read it: never the terminal, the app,
# or the host and its agents; the host's device secret is minted by the
# seed and goes to its record alone. The app is not exec'd, so the trap
# stops the host, the server and the database, and deletes the run's
# folder, however the run ends.
demo_profile="$HOME/Library/Application Support/$(luke_instance_app_name "$instance")"
if [[ -d $demo_profile ]]; then
    demo_agents_removed "$demo_profile"
    find "$demo_profile" -mindepth 1 -maxdepth 1 ! -name "$DEMO_KEPT_FOLDER" -exec rm -rf -- {} +
fi

# Dean's Claude credential is the one this shell already holds for Claude
# Code: its setup token, or else an Anthropic API key. The seed alone is
# handed it, under the name it reads for that kind (apps/web/server/demo-seed.ts),
# and a value of those names inherited from the shell is dropped first, so
# the credential comes from these two alone. Only where it came from is said.
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
    printf "demo: Dean's agents get the Claude credential in %s\n" "$demo_credential_source" >&2
else
    printf 'demo: neither CLAUDE_CODE_OAUTH_TOKEN nor ANTHROPIC_API_KEY is set, so Dean has no Claude credential and agents will not run; set one to run them\n' >&2
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
    # Note that the host stops first, which stops its agents, and that their folders go once it has.
    for pid in "$host_pid" "$server_pid" "$postgres_pid"; do
        if [[ -n $pid ]]; then
            kill "$pid" 2>/dev/null || true
            wait "$pid" 2>/dev/null || true
        fi
    done
    if [[ -n $host_pid ]]; then
        demo_agents_removed "$demo_profile"
    fi
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

# Note that the port is chosen before the seed, because the host's record
# names the origin it calls, and that the seed seals Dean's credential under
# the key ring the server opens it with, so the two are handed the one ring.
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
    exec pnpm --filter @luke/web demo:seed
)

# Note that node runs the server itself rather than `pnpm --filter @luke/web
# local-server`, because a pnpm that hands the run to the version the
# repository pins waits on it without passing a stop on, so the trap's stop
# would never reach the server.
(
    export DATABASE_URL="$demo_database_url" DATABASE_URL_UNPOOLED="$demo_database_url" \
        BETTER_AUTH_SECRET="$demo_auth_secret" PROVIDER_KEY_ENCRYPTION_KEYS="$demo_key_ring" \
        CRON_SECRET="$demo_cron_secret" BETTER_AUTH_URL="$demo_origin" APP_EVE_ORIGIN="$demo_origin"
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

# The host, from this checkout: the daemon's and the runner's bundles, each
# built by its package's own script, which writes in the version the service
# takes a host at (a bare build reports none and is refused), staged side by
# side in a `lib/` as a release carries them, since the daemon runs the
# runner from the `lib/` it stands in (packages/host/src/daemon/host-platform.ts).
# It runs under node itself, as the server does, so the trap's stop reaches
# it, and without the shell's Claude credential, which the seed alone is
# handed: its agents run on the one saved as Dean's. The first run fetches
# its agents' CLIs into the kept folder, and the host reads as getting ready
# in Settings › Hosts until it has them.
pnpm --filter @luke/host-daemon --filter @luke/agent-runner build >"$demo_folder/host-build.log" 2>&1 || {
    printf 'error: the demo host did not build; it printed:\n' >&2
    cat "$demo_folder/host-build.log" >&2
    exit 1
}
mkdir -p "$demo_folder/host/lib"
cp apps/host/dist/vespin-host.mjs packages/agent-runner/dist/agent-runner.mjs "$demo_folder/host/lib/"
env -u CLAUDE_CODE_OAUTH_TOKEN -u ANTHROPIC_API_KEY APP_HOST_STATE_ROOT="$demo_profile" \
    node "$demo_folder/host/lib/vespin-host.mjs" run >"$demo_folder/host.log" 2>&1 &
host_pid=$!
printf "demo: running this Mac's host for Dean, its log at %s\n" "$demo_folder/host.log" >&2

# Note that the app is handed acme's link, because a cleared profile opens
# the member's own workspace, which the seed leaves empty; the app holds the
# link until it is signed in (`@luke/features/app-links`), and a link among
# the arguments forwarded, the last, opens in its place.
export APP_ACCOUNT_BASE_URL="$demo_origin/api/auth"
pnpm start -- "$DEMO_LINK" "$@"
