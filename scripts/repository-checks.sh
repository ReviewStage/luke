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
    PROVIDERS.md
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
    apps/web/drizzle.config.ts
    apps/web/server/db/schema.ts
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

# Motion tokens, layout sizes, provider-mark path data, and session labels are
# the same contract between the desktop renderer and the marketing mock. One
# source, four committed outputs in sidecar-core; --check fails if any drifted.
node "$SIDECAR_REPO_ROOT/design/generate-surface-shared.mjs" --check

# Every relative import inside sidecar-core must carry its .js extension.
# Vercel's builder compiles the package's TypeScript into the web functions
# but leaves the specifiers alone, and Node's ESM loader refuses an
# extensionless one at run time — a break the build cannot see and production
# reports only as FUNCTION_INVOCATION_FAILED. The desktop's esbuild and the
# web's Vite both accept the .js form, so the stricter spelling costs the
# other consumers nothing.
extensionless_imports=$(grep -rEn 'from "\.\.?/[^"]*"' "$SIDECAR_REPO_ROOT/packages/sidecar-core/src" |
    grep -vE '\.(js|css)"' || true)
if [[ -n "$extensionless_imports" ]]; then
    printf 'error: sidecar-core relative imports must end in .js (Node ESM cannot load them compiled otherwise):\n%s\n' \
        "$extensionless_imports" >&2
    exit 1
fi

printf 'Repository contract checks passed.\n'
