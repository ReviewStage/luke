#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

sidecar_require_node

if [[ -r "$HOME/.nvm/nvm.sh" && -f "$SIDECAR_REPO_ROOT/.nvmrc" ]]; then
  # Oxlint's TypeScript plugin loader needs Node ^20.19.0 or >=22.18.0.
  # pnpm forwards npm's configured install prefix into lifecycle scripts, but
  # nvm refuses to select a runtime while that prefix is set. This process owns
  # the runtime selection below, and oxlint does not install global packages.
  unset npm_config_prefix
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  # shellcheck disable=SC1091
  source "$NVM_DIR/nvm.sh"
  nvm install >/dev/null
  nvm use >/dev/null
  export PATH="$NVM_DIR/versions/node/$(nvm current)/bin:$PATH"
fi

cd "$SIDECAR_REPO_ROOT"
exec pnpm exec oxlint --config .oxlintrc.json "$@"
