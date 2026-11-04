#!/usr/bin/env bash
# stack.sh -- the real app for a first-day run, in one process tree: Postgres, the demo seed, the demo member reset to a brand-new account, the local server, and the Playwright driver.
#
#   bash .agents/skills/first-day-user/scripts/stack.sh <run-folder>
#
# Run it in the background and keep it running for the whole session. A
# Vespin sandbox gives each command its own network, so the database, the
# server and the browser must share this one process tree; later commands
# reach the browser through the driver's file queue (`step.sh`), never the
# network. It prints `[stack] ready` once the driver takes steps, and stops
# everything, the tsx shims restored, when the driver quits (`quit.js`) or
# the script is stopped.
set -uo pipefail

RUN=${1:?usage: stack.sh <run-folder>}
SCRIPTS=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO=$(git -C "$SCRIPTS" rev-parse --show-toplevel)
PORT=${FIRST_DAY_PORT:-5173}
ORIGIN="http://127.0.0.1:$PORT"
DEMO_EMAIL="dean@example.com"
TSX_BINS=(node_modules/.bin/tsx apps/web/node_modules/.bin/tsx)

mkdir -p "$RUN/queue/in" "$RUN/queue/running" "$RUN/queue/out" "$RUN/shots" "$RUN/home"
RUN=$(CDPATH= cd -- "$RUN" && pwd)
cd "$REPO"

# Note that pnpm's own folders point at an unwritable home in the sandbox,
# and that the server refuses to start beside any VERCEL* variable.
export PNPM_HOME="$RUN/home/pnpm" NPM_CONFIG_PREFIX="$RUN/home/npm" XDG_DATA_HOME="$RUN/home/data" \
    XDG_CACHE_HOME="$RUN/home/cache" XDG_CONFIG_HOME="$RUN/home/config" XDG_STATE_HOME="$RUN/home/state"
mkdir -p "$PNPM_HOME" "$NPM_CONFIG_PREFIX" "$XDG_DATA_HOME" "$XDG_CACHE_HOME" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME"
for name in $(env | grep -o '^VERCEL[A-Z_]*'); do unset "$name"; done

random_key() { node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))'; }

# Note that the tsx CLI listens on a Unix socket, which the sandbox refuses,
# so the package scripts that call it (db:migrate, auth:seed, demo:seed) run
# through `node --import tsx` behind a shim, put back on exit.
for bin in "${TSX_BINS[@]}"; do
    cp "$bin" "$RUN/$(tr / _ <<<"$bin").orig"
    printf '#!/bin/sh\nexec node --import tsx "$@"\n' >"$bin"
done
postgres_pid="" server_pid="" driver_pid=""
cleanup() {
    kill $driver_pid $server_pid 2>/dev/null
    [[ -n $postgres_pid ]] && kill "$postgres_pid" 2>/dev/null
    wait 2>/dev/null
    for bin in "${TSX_BINS[@]}"; do cp "$RUN/$(tr / _ <<<"$bin").orig" "$bin"; done
    echo "[stack] stopped"
}
trap cleanup EXIT

auth_secret=$(random_key)
key_ring="1:$(random_key)"
cron_secret=$(random_key)

rm -f "$RUN/database-url"
node tools/demo-postgres/demo-postgres.ts --url-file "$RUN/database-url" >"$RUN/postgres.log" 2>&1 &
postgres_pid=$!
until [[ -s $RUN/database-url ]]; do
    kill -0 "$postgres_pid" 2>/dev/null || { echo "[stack] postgres failed"; cat "$RUN/postgres.log"; exit 1; }
    sleep 0.3
done
database_url=$(<"$RUN/database-url")
echo "[stack] postgres up"

DATABASE_URL="$database_url" PROVIDER_KEY_ENCRYPTION_KEYS="$key_ring" APP_DEMO_SERVICE_ORIGIN="$ORIGIN" \
    APP_DEMO_HOST_STATE="$RUN/host-state" pnpm --filter @repo/web demo:seed >"$RUN/seed.log" 2>&1 ||
    { echo "[stack] seed failed"; tail -30 "$RUN/seed.log"; exit 1; }
echo "[stack] seeded"

# Note that the seed gives the demo member a workspace and tasks, which would
# hide a first-run bug such as Nov 4, 2026's, so the member loses every
# membership and their personal workspace row before the browser opens: the
# app has to make their first workspace itself.
DATABASE_URL="$database_url" DEMO_EMAIL="$DEMO_EMAIL" node -e '
const { Client } = require(process.argv[1]);
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const [user] = (await client.query(`select id from "user" where email = $1`, [process.env.DEMO_EMAIL])).rows;
  const members = await client.query(`delete from member where user_id = $1`, [user.id]);
  const personal = await client.query(`delete from personal_workspace where user_id = $1`, [user.id]);
  console.log(`[stack] reset ${process.env.DEMO_EMAIL}: ${members.rowCount} memberships, ${personal.rowCount} personal workspace`);
  await client.end();
})();' "$REPO/apps/web/node_modules/pg" || exit 1

(
    export DATABASE_URL="$database_url" DATABASE_URL_UNPOOLED="$database_url" BETTER_AUTH_SECRET="$auth_secret" \
        PROVIDER_KEY_ENCRYPTION_KEYS="$key_ring" CRON_SECRET="$cron_secret" BETTER_AUTH_URL="$ORIGIN" \
        APP_DEPLOYMENT_ORIGIN="$ORIGIN"
    cd apps/web
    exec node --import tsx scripts/local-server.ts --port "$PORT"
) >"$RUN/server.log" 2>&1 &
server_pid=$!
serving=""
for _ in $(seq 1 240); do
    curl --silent --fail --max-time 5 --output /dev/null "$ORIGIN/api/auth/ok" && { serving=1; break; }
    kill -0 "$server_pid" 2>/dev/null || { echo "[stack] server died"; tail -40 "$RUN/server.log"; exit 1; }
    sleep 0.5
done
[[ -n $serving ]] || { echo "[stack] server never answered $ORIGIN/api/auth/ok"; tail -40 "$RUN/server.log"; exit 1; }
echo "[stack] serving $ORIGIN"

DATABASE_URL="$database_url" FIRST_DAY_ORIGIN="$ORIGIN" \
    NODE_PATH="/usr/local/lib/node_modules:$(npm root -g 2>/dev/null)" \
    node "$SCRIPTS/driver.cjs" "$RUN" "$REPO/apps/web/node_modules/pg" &
driver_pid=$!
wait "$driver_pid"
