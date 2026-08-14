#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

required_files=(
    AGENTS.md
    CLAUDE.md
    WORKFLOW.md
    README.md
    package.json
    pnpm-lock.yaml
    pnpm-workspace.yaml
    biome.json
    .nvmrc
    .husky/pre-commit
    tsconfig.base.json
    apps/desktop/package.json
    apps/desktop/scripts/package.mjs
    apps/desktop/scripts/release.mjs
    apps/desktop/native/macos/ScreenGeometry.swift
    apps/desktop/native/macos/TalkKey.swift
    packages/sidecar-core/package.json
    scripts/release-macos.sh
    scripts/verify.sh
    .conductor/settings.toml
    .github/pull_request_template.md
    .github/workflows/ci.yml
)

for required_file in "${required_files[@]}"; do
    if [[ ! -f "$SIDECAR_REPO_ROOT/$required_file" ]]; then
        printf 'error: required repository file is missing: %s\n' "$required_file" >&2
        exit 1
    fi
done

if [[ ! -x "$SIDECAR_REPO_ROOT/.husky/pre-commit" ]]; then
    printf 'error: Husky pre-commit hook must be executable\n' >&2
    exit 1
fi

find "$SIDECAR_REPO_ROOT/scripts" -type f -name '*.sh' -print0 |
    while IFS= read -r -d '' script; do
        bash -n "$script"
    done

git -C "$SIDECAR_REPO_ROOT" diff --check

# The brand artwork has one source and three sets of committed outputs cut from
# it: the SVGs, the face the renderer draws, and the motions it plays. If the
# copies no longer match the source, one of them is telling a story the artwork
# does not.
node "$SIDECAR_REPO_ROOT/design/generate-brand-assets.mjs" --check

printf 'Repository contract checks passed.\n'
