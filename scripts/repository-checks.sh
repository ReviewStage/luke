#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

required_files=(
    AGENTS.md
    design/check-design-contract.mjs
    CHANGELOG.md
    CLAUDE.md
    docs/WORKFLOW.md
    README.md
    package.json
    pnpm-lock.yaml
    pnpm-workspace.yaml
    biome.json
    .nvmrc
    .husky/pre-commit
    tsconfig.base.json
    apps/desktop/package.json
    apps/desktop/electron-builder.ts
    apps/desktop/scripts/electron-builder-config.mjs
    apps/desktop/scripts/electron-builder-hooks.mjs
    apps/desktop/scripts/prepare-builder-assets.mjs
    apps/desktop/native/macos/ScreenGeometry.swift
    apps/desktop/native/macos/TalkKey.swift
    apps/web/drizzle.config.ts
    apps/web/server/db/schema.ts
    packages/wire/package.json
    scripts/release-macos.sh
    scripts/verify.sh
    docs/DESIGN.md
    apps/desktop/src/renderer/AGENTS.md
    apps/desktop/src/renderer/CLAUDE.md
    packages/AGENTS.md
    packages/CLAUDE.md
    packages/analytics/AGENTS.md
    packages/analytics/CLAUDE.md
    packages/hosted/AGENTS.md
    packages/hosted/CLAUDE.md
    packages/providers/AGENTS.md
    packages/providers/CLAUDE.md
    packages/realtime/AGENTS.md
    packages/realtime/CLAUDE.md
    packages/surface/AGENTS.md
    packages/surface/CLAUDE.md
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

# The Node major is stated in more than one place because different readers look
# in different files, so they have to agree. `.nvmrc` is what local shells and
# CI read — the workflows name it as `node-version-file` — and Vercel reads
# neither it nor the root manifest: it takes `engines.node` from the deployed
# app and overrides its own dashboard setting with it. A stale `engines`
# therefore fails nothing and announces nothing local, and quietly ships
# production on a major no test ever ran on, which is how `22.x` outlived the
# move to 24. `.nvmrc` is the source; every declared major is checked against it.
nvmrc_major=$(sed -E 's/^v?([0-9]+).*$/\1/' "$SIDECAR_REPO_ROOT/.nvmrc" | head -1)
engines_drift=""
for manifest in "$SIDECAR_REPO_ROOT/package.json" \
    "$SIDECAR_REPO_ROOT"/apps/*/package.json \
    "$SIDECAR_REPO_ROOT"/packages/*/package.json; do
    declared=$(node -e 'const n = require(process.argv[1]).engines?.node; if (n) process.stdout.write(n)' \
        "$manifest")
    if [[ -z "$declared" ]]; then
        continue
    fi
    declared_major=$(printf '%s' "$declared" | grep -oE '[0-9]+' | head -1)
    if [[ "$declared_major" != "$nvmrc_major" ]]; then
        engines_drift+="${manifest#"$SIDECAR_REPO_ROOT/"}: engines.node \"$declared\" is not Node $nvmrc_major"$'\n'
    fi
done
if [[ -n "$engines_drift" ]]; then
    printf 'error: every engines.node must name the Node major .nvmrc pins (%s):\n%s' \
        "$nvmrc_major" "$engines_drift" >&2
    exit 1
fi

# The brand artwork has one source and three sets of committed outputs cut from
# it: the SVGs, the face the renderer draws, and the motions it plays. If the
# copies no longer match the source, one of them is telling a story the artwork
# does not.
node "$SIDECAR_REPO_ROOT/design/generate-brand-assets.mjs" --check

# Motion tokens, layout sizes, provider-mark path data, and session labels are
# the same contract between the desktop renderer and the marketing mock. One
# source, four committed outputs in @sidecar/surface; --check fails if any drifted.
node "$SIDECAR_REPO_ROOT/design/generate-surface-shared.mjs" --check

# Mount reveals, literal timings, loops, and layout-property animation obey the
# renderer contract in DESIGN.md. The checker keeps the bounded face-artwork
# exceptions explicit while rejecting new drift.
node "$SIDECAR_REPO_ROOT/design/check-design-contract.mjs"

# A prior cleanup stamped this sentence ahead of assertions without explaining
# any invariant. Specific SAFETY comments are part of the executable style
# contract; the boilerplate must not return.
generic_safety=$(grep -RFn --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
    'SAFETY: The preceding check establishes the asserted contract.' \
    "$SIDECAR_REPO_ROOT/apps" "$SIDECAR_REPO_ROOT/packages" || true)
if [[ -n "$generic_safety" ]]; then
    printf 'error: replace generic SAFETY comments with the concrete checked invariant:
%s
' \
        "$generic_safety" >&2
    exit 1
fi

# Every relative import the Vercel builder compiles must carry its .js
# extension. The builder compiles this TypeScript into the web functions but
# leaves the specifiers alone, and Node's ESM loader refuses an extensionless
# one at run time — a break the build cannot see and production reports only as
# FUNCTION_INVOCATION_FAILED. The desktop's esbuild and the web's Vite both
# accept the .js form, so the stricter spelling costs the other consumers
# nothing.
#
# The function sources are checked alongside the packages because the builder
# treats them identically: `apps/web/api` and `apps/web/server` are the entry
# points of the very graph the doors in `server/core.ts` exist to pull in, so a
# rule enforced on the packages alone leaves the two directories nearest the
# failure uncovered. Side-effect imports count — a door is spelled `import "…"`
# with no names, and an extensionless one fails exactly the same way.
extensionless_imports=$(grep -rEn '(from|import) "\.\.?/[^"]*"' \
    "$SIDECAR_REPO_ROOT"/packages/*/src \
    "$SIDECAR_REPO_ROOT"/apps/web/api \
    "$SIDECAR_REPO_ROOT"/apps/web/server |
    grep -vE '\.(js|css)"' || true)
if [[ -n "$extensionless_imports" ]]; then
    printf 'error: relative imports in packages/ and the web function sources must end in .js (Node ESM cannot load them compiled otherwise):\n%s\n' \
        "$extensionless_imports" >&2
    exit 1
fi

# Packages must not reach into apps: the dependency points the other way, and
# a relative path into apps/ evades the declared package graph, so typecheck
# resolves it without seeing the package → app → package cycle it creates.
# Every name the app re-exports originates in a package; import it from the
# defining package instead.
package_app_imports=$(grep -rEn '(from|import) "[^"]*apps/[^"]*"' \
    "$SIDECAR_REPO_ROOT"/packages/*/src || true)
if [[ -n "$package_app_imports" ]]; then
    printf 'error: packages must not import from apps/ (the path import hides a package → app → package cycle from the declared dependency graph):\n%s\n' \
        "$package_app_imports" >&2
    exit 1
fi

# The renderer is a sandboxed browser context: it reaches the main process
# through the preload bridge alone, so `#shared/bridge` and `#shared/wire/*`
# are its widest doors. A `#main/` import compiles and bundles happily and then fails in the
# browser, and a `node:` import does the same — neither is a mistake the type
# checker or esbuild can report, because both are real modules that simply are
# not there at run time.
#
# A colocated test is not the renderer: it runs under Node and never enters the
# bundle, so `node:test` is its whole point. The main-process door stays shut
# for it either way — a renderer test that needs main is testing the wrong side.
renderer_escapes=$(grep -ranE 'from "(#main/|node:)' "$SIDECAR_REPO_ROOT/apps/desktop/src/renderer" |
    grep -vE '\.test\.tsx?:[0-9]+:import .*"node:' || true)
if [[ -n "$renderer_escapes" ]]; then
    printf 'error: the renderer is sandboxed — it reaches the main process only through the shared bridge and wire modules:\n%s\n' \
        "$renderer_escapes" >&2
    exit 1
fi

# BRIDGE is the one renderer-to-main declaration, and registerBridge is the
# one place that may attach it to Electron. A handler registered beside its
# domain logic would bypass the manifest's sender and wire guards.
direct_ipc_registration=$(grep -RnaE --include='*.ts' 'ipcMain\.(handle|on)\(' \
    "$SIDECAR_REPO_ROOT/apps/desktop/src" |
    grep -v '/main/register-bridge.ts:' || true)
if [[ -n "$direct_ipc_registration" ]]; then
    printf 'error: Electron IPC handlers must be registered through registerBridge:\n%s\n' \
        "$direct_ipc_registration" >&2
    exit 1
fi

# The changelog references its screenshots by repository path, and the page
# serves them from the site root — a reference whose file is gone 404s
# silently on the page and draws a broken image on GitHub. The paths are
# word-splittable because the slug convention keeps them free of spaces.
changelog_image_paths=$(grep -oE '\]\(apps/web/public/[^)]+\)' "$SIDECAR_REPO_ROOT/CHANGELOG.md" |
    sed 's/^](//; s/)$//' || true)
for image_path in $changelog_image_paths; do
    if [[ ! -f "$SIDECAR_REPO_ROOT/$image_path" ]]; then
        printf 'error: CHANGELOG.md references a missing screenshot: %s\n' "$image_path" >&2
        exit 1
    fi
done

# The changelog page splits releases on "## <version> — <YYYY-MM-DD>" and its
# parser throws on any other shape — at module load in the browser, which no
# build step executes. This check is what keeps a malformed heading out of a
# visitor's tab.
malformed_release_headings=$(grep -E '^## ' "$SIDECAR_REPO_ROOT/CHANGELOG.md" |
    grep -vE '^## [0-9]+\.[0-9]+\.[0-9]+ — [0-9]{4}-[0-9]{2}-[0-9]{2}$' || true)
if [[ -n "$malformed_release_headings" ]]; then
    printf 'error: CHANGELOG.md release headings must read "## <version> — <YYYY-MM-DD>":\n%s\n' \
        "$malformed_release_headings" >&2
    exit 1
fi

# A release is its tag, and the tag must match apps/desktop/package.json — so
# requiring the changelog to name the packaged version makes the version-bump
# change carry the release's notes, which the landing page renders at
# /changelog. See .github/RELEASE.md.
desktop_version=$(node -p "require('$SIDECAR_REPO_ROOT/apps/desktop/package.json').version")
if ! grep -Eq "^## ${desktop_version//./\\.}( |$)" "$SIDECAR_REPO_ROOT/CHANGELOG.md"; then
    printf 'error: CHANGELOG.md has no entry for version %s — every release adds its notes before its tag is pushed\n' \
        "$desktop_version" >&2
    exit 1
fi

printf 'Repository contract checks passed.\n'
