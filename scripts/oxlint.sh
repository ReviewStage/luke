#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

# Oxlint's TypeScript plugin loader needs Node ^20.19.0 or >=22.18.0, which the
# Node 24 floor below already meets. Note that we lint on the Node already on
# PATH rather than asking nvm for `.nvmrc`'s, because `nvm install` resolves the
# version against nodejs.org on every run: CI's Node comes from setup-node, not
# nvm, so each lint downloaded Node again, and a failed fetch failed the lint
# with "Version '24' not found" in files nobody touched.
luke_require_node

cd "$LUKE_REPO_ROOT"
exec pnpm exec oxlint --config .oxlintrc.json "$@"
