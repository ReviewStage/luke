#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

app_require_node
"$SCRIPT_DIRECTORY/repository-checks.sh"

cd "$APP_REPO_ROOT"
pnpm --filter @repo/database check:migrations
MIGRATIONS="$APP_REPO_ROOT/packages/database/migrations"
migrations_before=$(ls "$MIGRATIONS")
pnpm --filter @repo/database db:generate --name=unmigrated_schema </dev/null
unmigrated=$(comm -13 <(echo "$migrations_before") <(ls "$MIGRATIONS"))
if [[ -n "$unmigrated" ]]; then
  for folder in $unmigrated; do rm -r "${MIGRATIONS:?}/$folder"; done
  echo "A schema module changed without its migration: run \`pnpm db:generate --name=<what it does>\` and commit the folder it writes." >&2
  exit 1
fi
pnpm check "$@"
