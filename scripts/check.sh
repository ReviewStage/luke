#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

luke_require_node
"$SCRIPT_DIRECTORY/repository-checks.sh"

cd "$LUKE_REPO_ROOT"
# Two branches' migrations that do not commute pass every other check and
# fail on the deploy that applies the second, so drizzle-kit reads the
# folders' snapshot graph before anything else runs.
pnpm --filter @luke/database check:migrations
# A schema module changed without its migration is caught by asking
# drizzle-kit for one: `generate` merges every leaf snapshot itself, so a
# branch beside main's newer migration passes when the two commute.
MIGRATIONS="$LUKE_REPO_ROOT/packages/database/migrations"
migrations_before=$(ls "$MIGRATIONS")
pnpm --filter @luke/database db:generate --name=unmigrated_schema </dev/null
unmigrated=$(comm -13 <(echo "$migrations_before") <(ls "$MIGRATIONS"))
if [[ -n "$unmigrated" ]]; then
  for folder in $unmigrated; do rm -r "${MIGRATIONS:?}/$folder"; done
  echo "A schema module changed without its migration: run \`pnpm db:generate --name=<what it does>\` and commit the folder it writes." >&2
  exit 1
fi
pnpm check "$@"
