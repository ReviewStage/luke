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
    docs/adr/0001-effect.md
    apps/desktop/src/renderer/AGENTS.md
    apps/desktop/src/renderer/CLAUDE.md
    packages/AGENTS.md
    packages/CLAUDE.md
    packages/analytics/AGENTS.md
    packages/analytics/CLAUDE.md
    packages/gateway/AGENTS.md
    packages/gateway/CLAUDE.md
    packages/host/AGENTS.md
    packages/host/CLAUDE.md
    packages/hosted/AGENTS.md
    packages/hosted/CLAUDE.md
    packages/live/AGENTS.md
    packages/live/CLAUDE.md
    packages/providers/AGENTS.md
    packages/providers/CLAUDE.md
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

# The runtime keeps two doors: the barrel, which reaches `node:fs` and croner,
# and `@sidecar/runtime/vocabulary`, which the packages below the runtime import
# so neither reaches a renderer bundle or a web function. The split only holds
# while no name leaves through both — a name behind two doors is a name a
# consumer can reach through the wrong one, and `export *` silently drops one of
# them where the web server's `core.ts` opens both.
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  import path from "node:path";
  const directory = path.join(process.argv[1], "packages/runtime/src");
  const exported = async (file) => {
    const text = await readFile(path.join(directory, file), "utf8");
    const names = new Set();
    for (const block of text.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
      for (const specifier of block[1].split(",")) {
        const name = specifier.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
        if (name) names.add(name.trim());
      }
    }
    for (const declaration of text.matchAll(
      /export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum)\s+(\w+)/g,
    )) {
      names.add(declaration[1]);
    }
    return names;
  };
  const barrel = await exported("index.ts");
  const vocabulary = await exported("vocabulary.ts");
  const both = [...vocabulary].filter((name) => barrel.has(name)).sort();
  if (both.length > 0) {
    process.stderr.write(
      `error: these names leave @sidecar/runtime through both doors: ${both.join(", ")}\n`,
    );
    process.exit(1);
  }
' "$SIDECAR_REPO_ROOT"

# The packages below the runtime (live, hosted, voice, devtrace, memory) open
# `@sidecar/runtime/vocabulary` precisely because it resolves no Node module
# and no Effect layer that would carry one in. The renderer's own `node:` grep
# (below) can only see files inside one directory; this walks the door's
# actual relative-import graph, the way the barrel/vocabulary check above
# walks its export lists, so a later re-export cannot quietly reintroduce
# `@effect/platform-node` a few files deep.
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  import path from "node:path";
  const root = path.join(process.argv[1], "packages/runtime/src");
  const forbidden = /^(node:|@effect\/(platform-node|sql))/;
  const seen = new Set();
  const offenders = [];
  const walk = async (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(/from\s+"([^"]+)"/g)) {
      const specifier = match[1];
      if (forbidden.test(specifier)) {
        offenders.push(`${path.relative(root, file)}: ${specifier}`);
      } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
        await walk(path.join(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
      }
    }
  };
  await walk(path.join(root, "vocabulary.ts"));
  if (offenders.length > 0) {
    process.stderr.write(
      `error: @sidecar/runtime/vocabulary resolves a Node-reaching import: ${offenders.join(", ")}\n`,
    );
    process.exit(1);
  }
' "$SIDECAR_REPO_ROOT"

# A tool module under `packages/brain/src/tools/` reaches the brain only
# through the context its `execute` is handed: it imports the packages below
# the brain and its own directory, never the agent, the turn runner, the
# ledger, or anything else of the brain by relative path. That is what lets a
# tool be read, tested, and moved to another runtime without the agent that
# runs it, and what keeps `admit()` inside `execute` rather than beside it.
node --input-type=module -e '
  import { readdir, readFile } from "node:fs/promises";
  import path from "node:path";
  const directory = path.join(process.argv[1], "packages/brain/src/tools");
  const reaching = [];
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".ts")).sort()) {
    const text = await readFile(path.join(directory, file), "utf8");
    for (const match of text.matchAll(/from\s+"([^"]+)"/g)) {
      const specifier = match[1];
      if (specifier.startsWith("../") || specifier.startsWith("@sidecar/brain")) {
        reaching.push(`${file}: ${specifier}`);
      }
    }
  }
  if (reaching.length > 0) {
    process.stderr.write(
      `error: a tool module reaches into the brain outside its directory: ${reaching.join(", ")}\n`,
    );
    process.exit(1);
  }
' "$SIDECAR_REPO_ROOT"

# Admission has one home in the brain: a tool module's own `execute`, under
# `packages/brain/src/tools/`. Nothing else of the brain, and nothing in the
# host's brain wiring or the memory package, may call `admit()` or
# `admitEffect()` or reach for either, so no path can hand the host a raw call
# to admit and carry in one breath — the notebook's two writes included, which
# arrive at the host as admitted actions like every other. The check reads
# import lists rather than call sites, because a file that never imports
# `admit` cannot call it.
node --input-type=module -e '
  import { readdir, readFile } from "node:fs/promises";
  import path from "node:path";
  const root = process.argv[1];
  const scopes = [
    { directory: "packages/brain/src", allowed: "packages/brain/src/tools" },
    { directory: "packages/host/src/brain", allowed: undefined },
    { directory: "packages/host/src", allowed: undefined, only: ["memory-definition.ts"] },
    { directory: "packages/memory/src", allowed: undefined },
  ];
  const reaching = [];
  for (const scope of scopes) {
    const directory = path.join(root, scope.directory);
    const entries = await readdir(directory, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;
      if (scope.only && !scope.only.includes(entry.name)) continue;
      const file = path.join(entry.parentPath, entry.name);
      const relative = path.relative(root, file);
      if (scope.allowed && relative.startsWith(scope.allowed)) continue;
      const text = await readFile(file, "utf8");
      for (const match of text.matchAll(/import\s*(?:type\s+)?\{([^}]*)\}\s*from\s+"@sidecar\/actions"/g)) {
        const names = match[1].split(",").map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
        if (names.includes("admit") || names.includes("admitEffect")) reaching.push(relative);
      }
    }
  }
  if (reaching.length > 0) {
    process.stderr.write(
      `error: admit() is reached outside the brain tool modules: ${reaching.join(", ")}\n`,
    );
    process.exit(1);
  }
' "$SIDECAR_REPO_ROOT"

# Everything this Mac observes, draws, and acts on arrives through the
# service, never through a provider adapter held here: the host and the
# desktop import nothing from `@sidecar/providers`, so no path from a turn, a
# row, or a window can reach a provider plugin, a CLI, or a local file without
# the service's admission in between. The web functions still compile the
# Conductor cloud adapter out of that package by relative path, which is the
# service's own read and not this Mac's. The one file excluded holds the
# spoken introduction's keyless local peek, whose removal is a product
# decision still open; it is the last import this fence tolerates.
host_provider_imports=$(grep -rEn 'from "@sidecar/providers(/[^"]*)?"' \
    --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' \
    --exclude='register-desktop-ipc.ts' \
    "$SIDECAR_REPO_ROOT"/packages/host/src \
    "$SIDECAR_REPO_ROOT"/apps/desktop/src || true)
if [[ -n "$host_provider_imports" ]]; then
    printf 'error: this Mac reaches a provider adapter outside the service:\n%s\n' \
        "$host_provider_imports" >&2
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

# Vercel registers api/ functions from the uploaded tree before the build runs,
# so each function's committed api/*.js stub is what gets deployed, and the
# vercel.json rewrites are what land a route on its grouped function; --check
# fails if a function has no stub, a stub or rewrite went stale, or a .js under
# api/ has no function.
pnpm --dir "$SIDECAR_REPO_ROOT/apps/web" exec tsx scripts/function-stubs.ts --check

# The public platform table is a direct projection of the session package's
# narrow provider identity catalog. Privacy wording stays manually reviewed.
pnpm --dir "$SIDECAR_REPO_ROOT/packages/session" exec tsx \
    "$SIDECAR_REPO_ROOT/scripts/generate-provider-readme.ts" --check

# Mount reveals, literal timings, loops, and layout-property animation obey the
# renderer contract in DESIGN.md. The checker keeps the bounded face-artwork
# exceptions explicit while rejecting new drift.
node "$SIDECAR_REPO_ROOT/design/check-design-contract.mjs"

# A prior cleanup stamped this sentence ahead of assertions without explaining
# any invariant. Specific SAFETY comments are part of the executable style
# contract; the boilerplate must not return.
generic_safety=$(grep -rFn --exclude-dir=node_modules --include='*.ts' --include='*.tsx' --include='*.js' --include='*.mjs' \
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

# Every provider passes one contract suite, and its recorded answers are the
# ruler. A golden is written by the suite itself in one canonical formatting —
# object keys sorted at every depth, two-space indent, a trailing newline — so
# a hand edit is a claim about a provider's behaviour that no provider made.
# Biome is kept off the fixture tree for the same reason, which leaves this as
# the only thing that would notice.
node --input-type=module -e '
  import { readdir, readFile } from "node:fs/promises";
  import path from "node:path";
  const root = path.join(process.argv[1], "packages/session/fixtures/providers");
  const sorted = (value) =>
    `${JSON.stringify(
      value,
      (_key, entry) =>
        typeof entry !== "object" || entry === null || Array.isArray(entry)
          ? entry
          : Object.fromEntries(Object.keys(entry).sort().map((key) => [key, entry[key]])),
      2,
    )}\n`;
  const drifted = [];
  for (const provider of await readdir(root)) {
    const goldenDirectory = path.join(root, provider, "golden");
    const names = await readdir(goldenDirectory).catch(() => []);
    for (const name of names) {
      const filePath = path.join(goldenDirectory, name);
      const recorded = await readFile(filePath, "utf8");
      const canonical = name.endsWith(".json")
        ? sorted(JSON.parse(recorded))
        : recorded.endsWith("\n")
          ? recorded
          : `${recorded}\n`;
      if (recorded !== canonical) drifted.push(path.relative(process.argv[1], filePath));
    }
  }
  if (drifted.length > 0) {
    process.stderr.write(
      `error: a recorded golden is not in the formatting the contract suite writes (record it with LUKE_UPDATE_FIXTURES=1 rather than editing it):\n${drifted.join("\n")}\n`,
    );
    process.exit(1);
  }
' "$SIDECAR_REPO_ROOT"

# docs/DESIGN.md admits one native motion on the surface: the Conversation thread's
# stamp column, scrolled in by the thread's own sideways scroll and put back by
# scroll snapping, because only the browser sees the fingers lift. Everything
# else moves on the spring, so a snap anywhere else is a second exception the
# contract has not granted.
snaps_outside_history=$(grep -rln 'scroll-snap-type' "$SIDECAR_REPO_ROOT/apps/desktop/src/renderer/styles" |
    grep -v '/conversation\.css$' || true)
if [[ -n "$snaps_outside_history" ]]; then
    printf 'error: scroll snapping is the Conversation thread'"'"'s alone (docs/DESIGN.md); found in:\n%s\n' \
        "$snaps_outside_history" >&2
    exit 1
fi

# The web functions are bundled from server/routes/ into api/ with every
# workspace package inlined, so a bare `@sidecar/…` specifier is resolved by
# esbuild at build time from apps/web's own node_modules. pnpm links there only
# what apps/web/package.json declares, so a specifier the web app's sources name
# without declaring resolves in a developer's hoisted tree, typechecks, and
# fails the deploy's bundle step, or, for the Vite client, ships a bundle that
# happened to resolve through another package's link. Declare what is named.
web_manifest="$SIDECAR_REPO_ROOT/apps/web/package.json"
declared_web_packages=$(grep -oE '"@sidecar/[a-z-]+": "workspace:\*"' "$web_manifest" |
    sed -E 's#"@sidecar/([a-z-]+)".*#\1#' | sort -u)
named_web_packages=$(grep -rhoE --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' \
    '(from|import) "@sidecar/[a-z-]+(/[a-z-]+)?"' \
    "$SIDECAR_REPO_ROOT/apps/web/server" "$SIDECAR_REPO_ROOT/apps/web/src" "$SIDECAR_REPO_ROOT/apps/web/scripts" |
    sed -E 's#.*"@sidecar/([a-z-]+).*"#\1#' | sort -u)
undeclared_web_packages=""
while IFS= read -r named_name; do
    [[ -z "$named_name" ]] && continue
    if ! grep -qx "$named_name" <<<"$declared_web_packages"; then
        undeclared_web_packages+="$named_name"$'\n'
    fi
done <<<"$named_web_packages"
if [[ -n "$undeclared_web_packages" ]]; then
    printf 'error: apps/web names workspace packages its package.json does not declare (the function bundle resolves bare @sidecar specifiers from apps/web/node_modules, which pnpm links from the declared dependencies alone):\n%s\n' \
        "$undeclared_web_packages" >&2
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
# through the preload bridge alone, so `#shared/bridge`, `#shared/messages/*`,
# and the packages' own wire vocabularies are its widest doors. A `#main/` import compiles and bundles happily and then fails in the
# browser, and a `node:` import does the same — neither is a mistake the type
# checker or esbuild can report, because both are real modules that simply are
# not there at run time.
#
# A colocated test is not the renderer: it runs under Node and never enters
# the bundle, so a `node:assert` import is its whole point. The main-process
# door stays shut for it either way — a renderer test that needs main is
# testing the wrong side.
renderer_escapes=$(grep -ranE 'from "(#main/|node:)' "$SIDECAR_REPO_ROOT/apps/desktop/src/renderer" |
    grep -vE '\.test\.tsx?:[0-9]+:import .*"node:' || true)
if [[ -n "$renderer_escapes" ]]; then
    printf 'error: the renderer is sandboxed — it reaches the main process only through the shared bridge and wire modules:\n%s\n' \
        "$renderer_escapes" >&2
    exit 1
fi

# A hosted quota is the service's own accounting, and the customer-facing panel
# says only that voice is temporarily unavailable — never a number, a meter or a
# reset time. The diagnostics the renderer receives carry the members, so the
# rule is that nothing drawn reads them.
drawn_hosted_quota=$(grep -rnaE --include='*.ts' --include='*.tsx' \
    'requestHostedUsage|hostedUsage|<meter\b|quota\.(used|limit|remaining|resetsAt)' \
    "$SIDECAR_REPO_ROOT/apps/desktop/src/renderer" |
    grep -vE '\.test\.tsx?:' || true)
if [[ -n "$drawn_hosted_quota" ]]; then
    printf 'error: hosted quota values must not reach the customer-facing renderer:\n%s\n' \
        "$drawn_hosted_quota" >&2
    exit 1
fi

# A temporary directory, a microtask drain, a fake clock, a native-helper
# process and a brain composition were each hand-rolled in several test files,
# and every copy drifted: three temporary directories were never cleaned up and
# four drains had settled on four different tick counts for the same wait. The
# first three live in @sidecar/runtime/testing, because the host's tests are in
# a package and a package cannot reach into an app; the rest are under
# apps/desktop/src/testing. These two calls are how a hand-rolled one always
# begins.
hand_rolled_fixtures=$(grep -rnaE --include='*.test.ts' --include='*.test.tsx' \
    'mkdtemp|setImmediate' \
    "$SIDECAR_REPO_ROOT/apps/desktop/src" "$SIDECAR_REPO_ROOT/packages/host/src" || true)
if [[ -n "$hand_rolled_fixtures" ]]; then
    printf 'error: test files import temporaryDirectory and drainMicrotasks from @sidecar/runtime/testing rather than hand-rolling them:\n%s\n' \
        "$hand_rolled_fixtures" >&2
    exit 1
fi

# Every workspace's tests run on vitest; `node:test` is retired. The `.mjs`
# harness under `test:harness` is the one holdout, and it is exempt by
# extension alone, never by path.
node_test_imports=$(grep -rnE --include='*.ts' --include='*.tsx' --include='*.mts' \
    'from "node:test"|require\("node:test"\)' \
    "$SIDECAR_REPO_ROOT/apps" "$SIDECAR_REPO_ROOT/packages" "$SIDECAR_REPO_ROOT/tools" || true)
if [[ -n "$node_test_imports" ]]; then
    printf 'error: these files still import node:test; every TypeScript test runs on vitest:\n%s\n' \
        "$node_test_imports" >&2
    exit 1
fi

# BRIDGE is the one renderer-to-main declaration, and registerBridgeHost is
# the one place that may attach it to Electron. A handler registered beside its
# domain logic would bypass the manifest's sender and wire guards, and an act
# registered on a channel of its own would bypass the router.
direct_ipc_registration=$(grep -rnaE --exclude-dir=node_modules --include='*.ts' 'ipcMain\.(handle|on)\(' \
    "$SIDECAR_REPO_ROOT/apps/desktop/src" |
    grep -v '/main/bridge-host.ts:' || true)
if [[ -n "$direct_ipc_registration" ]]; then
    printf 'error: Electron IPC handlers must be registered through registerBridgeHost:\n%s\n' \
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

# Effect's Context.Tag identity is per module instance: two resolved copies of
# "effect" in the dependency tree mint two tags that fail their own equality
# check. The catalog is what pins every package to the one resolved version, so
# a literal version here is the one thing that can quietly reintroduce a second
# copy.
literal_effect_versions=$(grep -rnE '"effect": *"[^c]' --include=package.json \
    --exclude-dir=node_modules \
    "$SIDECAR_REPO_ROOT/apps" "$SIDECAR_REPO_ROOT/packages" "$SIDECAR_REPO_ROOT/tools" || true)
if [[ -n "$literal_effect_versions" ]]; then
    printf 'error: "effect" must be declared as "catalog:", never a literal version:\n%s\n' \
        "$literal_effect_versions" >&2
    exit 1
fi

# `Admitted` is a nominal brand behind a module-private `unique symbol`, and the
# whole point is that the set is entered in one place. The type system already
# refuses an object literal, but a cast spells the brand out and would enter the
# set from anywhere it is written, so the cast lives in the two wire modules that
# define and re-shape the brand and in `admit()`, the one minter. An Effect
# `Schema.brand` would be a third way in, which is why admission is not one.
admitted_casts=$(grep -rEn --exclude-dir=node_modules --include='*.ts' --include='*.tsx' 'as Admitted\b' \
    "$SIDECAR_REPO_ROOT/apps" "$SIDECAR_REPO_ROOT/packages" "$SIDECAR_REPO_ROOT/tools" |
    grep -vE '/(packages/actions/src/admit\.ts|packages/wire/src/admitted\.ts|packages/wire/src/testing/admitted[^/]*\.ts):' || true)
if [[ -n "$admitted_casts" ]]; then
    printf 'error: the Admitted brand is cast only in admit() and wire'"'"'s admitted modules — reshapeAdmitted() is how everything else re-shapes what admission already minted:\n%s\n' \
        "$admitted_casts" >&2
    exit 1
fi

# The SpeechClaim brand is the one authorization to speak a briefing, and
# claimSpeech() in the speech store module is its one minter: a briefing
# append takes a claim, so an append that never claimed does not compile, and
# that holds only while nothing else can spell the brand into being.
speech_claim_casts=$(grep -rEn --exclude-dir=node_modules --include='*.ts' --include='*.tsx' 'as SpeechClaim\b' \
    "$SIDECAR_REPO_ROOT/apps" "$SIDECAR_REPO_ROOT/packages" "$SIDECAR_REPO_ROOT/tools" |
    grep -vE '/apps/web/server/hosted/store/speech\.ts:' || true)
if [[ -n "$speech_claim_casts" ]]; then
    printf 'error: the SpeechClaim brand is minted only by claimSpeech() in the speech store module — a briefing is spoken with the claim it answered, never one spelled elsewhere:\n%s\n' \
        "$speech_claim_casts" >&2
    exit 1
fi

# A file ported from OpenClaw stays faithful to the pinned `b7528507`, so a
# later port of an upstream change reads as a diff of that source and nothing
# else. Effect reaches these through a sibling `*.effect.ts` beside each one,
# which is why the list is spelled out rather than matched by a pattern: the
# sibling imports `effect` and the port never does.
openclaw_ported_files=(
    packages/runtime/src/queue.ts
    packages/runtime/src/lanes.ts
    packages/runtime/src/children.ts
    packages/runtime/src/child-records.ts
    packages/runtime/src/workspace.ts
    packages/runtime/src/prompt.ts
    packages/runtime/src/tool-policy.ts
    packages/runtime/src/storage.ts
    packages/runtime/src/skills.ts
    packages/memory/src/defaults.ts
    packages/memory/src/ranking.ts
    packages/memory/src/chunking.ts
    packages/memory/src/flush.ts
    packages/brain/src/loop-guard.ts
    packages/brain/src/compaction.ts
    packages/brain/src/context-engine.ts
    packages/brain/src/state-store.ts
    packages/brain/src/store/maintenance.ts
    packages/brain/src/store/maintenance-run.ts
    packages/brain/src/store/archives.ts
    packages/brain/src/store/compression.ts
)
openclaw_effect_imports=""
for ported in "${openclaw_ported_files[@]}"; do
    if [[ ! -f "$SIDECAR_REPO_ROOT/$ported" ]]; then
        printf 'error: this check names a file that no longer exists: %s\n' "$ported" >&2
        exit 1
    fi
    openclaw_effect_imports+=$(grep -nE 'from "(effect|@effect/[^"]+)"|require\("(effect|@effect/[^"]+)"\)' \
        "$SIDECAR_REPO_ROOT/$ported" | sed "s|^|$ported:|" || true)
done
if [[ -n "$openclaw_effect_imports" ]]; then
    printf 'error: these files are ported from OpenClaw b7528507 and must import nothing from effect — put the Effect surface in the sibling *.effect.ts beside each one:\n%s\n' \
        "$openclaw_effect_imports" >&2
    exit 1
fi

# `@effect/platform-node` and `@effect/sql*` reach `node:` modules, so an import
# of either compiles and bundles happily and then fails where there is no Node:
# in the sandboxed renderer, and in a web function whose builder ships only what
# it could follow. The renderer's `node:` grep above catches the direct reach;
# this catches the Effect layer that would carry it in behind a bare specifier.
node_reaching_effect=$(grep -rEn --include='*.ts' --include='*.tsx' \
    '"@effect/(platform-node|sql)' \
    "$SIDECAR_REPO_ROOT/apps/desktop/src/renderer" "$SIDECAR_REPO_ROOT/apps/web/api" || true)
if [[ -n "$node_reaching_effect" ]]; then
    printf 'error: @effect/platform-node and @effect/sql* reach node: modules and must not be imported by the renderer or a web function — put the layer behind the runtime edge that builds it:\n%s\n' \
        "$node_reaching_effect" >&2
    exit 1
fi

printf 'Repository contract checks passed.\n'
