#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

find "$LUKE_REPO_ROOT/scripts" -type f -name '*.sh' -print0 |
    while IFS= read -r -d '' script; do
        bash -n "$script"
    done

git -C "$LUKE_REPO_ROOT" diff --check

# The Node major is stated in more than one place because different readers look
# in different files, so they have to agree. `.nvmrc` is what local shells and
# CI read — the workflows name it as `node-version-file` — and Vercel reads
# neither it nor the root manifest: it takes `engines.node` from the deployed
# app and overrides its own dashboard setting with it. A stale `engines`
# therefore fails nothing and announces nothing local, and quietly ships
# production on a major no test ever ran on, which is how `22.x` outlived the
# move to 24. `.nvmrc` is the source; every declared major is checked against it.
nvmrc_major=$(sed -E 's/^v?([0-9]+).*$/\1/' "$LUKE_REPO_ROOT/.nvmrc" | head -1)
engines_drift=""
for manifest in "$LUKE_REPO_ROOT/package.json" \
    "$LUKE_REPO_ROOT"/apps/*/package.json \
    "$LUKE_REPO_ROOT"/packages/*/package.json; do
    declared=$(node -e 'const n = require(process.argv[1]).engines?.node; if (n) process.stdout.write(n)' \
        "$manifest")
    if [[ -z "$declared" ]]; then
        continue
    fi
    declared_major=$(printf '%s' "$declared" | grep -oE '[0-9]+' | head -1)
    if [[ "$declared_major" != "$nvmrc_major" ]]; then
        engines_drift+="${manifest#"$LUKE_REPO_ROOT/"}: engines.node \"$declared\" is not Node $nvmrc_major"$'\n'
    fi
done
if [[ -n "$engines_drift" ]]; then
    printf 'error: every engines.node must name the Node major .nvmrc pins (%s):\n%s' \
        "$nvmrc_major" "$engines_drift" >&2
    exit 1
fi

# The packages below the runtime (live, features, voice) open
# `@luke/runtime/vocabulary` precisely because it resolves no Node module
# and no Effect layer that would carry one in. The renderer's own `node:` grep
# (below) can only see files inside one directory; this walks the door's
# actual relative-import graph, so a later re-export cannot quietly reintroduce
# `@effect/platform-node` or `effect/sql` a few files deep.
#
# `@luke/host`, `@luke/host/effect`, `@luke/host/act-router`, and
# `@luke/host/client` are walked the same way, because the host, its act
# table, and the client core that keeps the app-state document are meant to
# load in a browser tab: their graphs name no `node:` module, no `ws`, no
# `electron`, no `@luke/host/node`, and no `Buffer` or `process` global, and
# what needs one sits behind
# `@luke/host/node`. The walk crosses into `@luke/credentials` through the
# doors the host names (its barrel and `/snapshot`), since the account's
# sign-in lives there: the loopback consent sits behind
# `@luke/credentials/node`, handed to the host as its `SignInConsent` seam.
# Every other package a walk reaches is still left unchecked here.
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  import path from "node:path";
  const doors = [
    {
      name: "@luke/runtime/vocabulary",
      root: "packages/runtime/src",
      entries: ["vocabulary.ts"],
      forbidden: /^(node:|@effect\/platform-node|effect\/sql)/,
    },
    {
      name: "@luke/host, @luke/host/effect, @luke/host/act-router, and @luke/host/client",
      root: "packages/host/src",
      entries: ["index.ts", "effect/index.ts", "act-router/index.ts", "client/index.ts"],
      forbidden: /^(node:|ws$|electron$|@effect\/platform-node|@luke\/host\/node)/,
      globals: /\b(Buffer|process)\.\w+/,
      follows: ["@luke/credentials"],
    },
  ];
  const repository = process.argv[1];
  // A followed package is entered where its own `exports` says the
  // specifier lands, so the walk takes the same door a resolver would.
  const followed = async (door, specifier) => {
    const name = door.follows?.find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
    if (!name) return undefined;
    const directory = path.join(repository, "packages", name.slice("@luke/".length));
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    const target = manifest.exports[`.${specifier.slice(name.length)}`];
    return path.join(directory, target.replace(/\.js$/, ".ts"));
  };
  let failed = false;
  for (const door of doors) {
    const seen = new Set();
    const offenders = [];
    const walk = async (file) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = await readFile(file, "utf8");
      const global = door.globals ? text.match(door.globals) : null;
      if (global) offenders.push(`${path.relative(repository, file)}: ${global[0]}`);
      for (const match of text.matchAll(/from\s+"([^"]+)"/g)) {
        const specifier = match[1];
        if (door.forbidden.test(specifier)) {
          offenders.push(`${path.relative(repository, file)}: ${specifier}`);
        } else if (specifier.startsWith("./") || specifier.startsWith("../")) {
          await walk(path.join(path.dirname(file), specifier.replace(/\.js$/, ".ts")));
        } else {
          const entered = await followed(door, specifier);
          if (entered) await walk(entered);
        }
      }
    };
    for (const entry of door.entries) await walk(path.join(repository, door.root, entry));
    if (offenders.length > 0) {
      failed = true;
      process.stderr.write(
        `error: ${door.name} resolves a Node-reaching import: ${offenders.join(", ")}\n`,
      );
    }
  }
  if (failed) process.exit(1);
' "$LUKE_REPO_ROOT"

# The brand artwork has one source and committed outputs cut from it: the
# SVGs, the face the renderer draws, the motions it plays, and the motion
# tokens, layout sizes, and provider-mark path data the desktop renderer and
# the marketing mock share. If a copy no longer matches the source, it is
# telling a story the artwork does not; --check fails on any drift.
pnpm --dir "$LUKE_REPO_ROOT" --filter @luke/brand --silent check

# The vercel.json rewrites are what land a route on its grouped function, and
# they are generated from server/routes/; --check fails if a rewrite went stale.
pnpm --dir "$LUKE_REPO_ROOT/apps/web" exec tsx scripts/function-rewrites.ts --check

# The constants clients build /api/ URLs from are the other half of that
# table: a path constant can outlive its route and nothing fails until
# production answers 404 (LUKE-186). Every /api/ literal and path builder under
# apps/desktop/src, packages/*/src, scripts, and tools must resolve
# to a rewrite of the table or an extensionless alias the Build Output emits.
pnpm --dir "$LUKE_REPO_ROOT/apps/web" exec tsx scripts/api-callers.ts

# Every relative import the Vercel builder compiles must carry its .js
# extension. The builder compiles this TypeScript into the web functions but
# leaves the specifiers alone, and Node's ESM loader refuses an extensionless
# one at run time — a break the build cannot see and production reports only as
# FUNCTION_INVOCATION_FAILED. The desktop's esbuild and the web's Vite both
# accept the .js form, so the stricter spelling costs the other consumers
# nothing.
#
# The function sources are checked alongside the packages because the builder
# treats them identically: `apps/web/server` — whose `routes/` subtree holds one
# module per deployed function — is the entry point of the very graph the doors
# in `packages/service/src/core.ts` exist to pull in, so a rule enforced on the packages alone
# leaves the directory nearest the failure uncovered. Side-effect imports count
# — a door is spelled `import "…"` with no names, and an extensionless one fails
# exactly the same way.
extensionless_imports=$(grep -rEn '(from|import) "\.\.?/[^"]*"' \
    "$LUKE_REPO_ROOT"/packages/*/src \
    "$LUKE_REPO_ROOT"/apps/web/server |
    grep -vE '\.(js|css)"' || true)
if [[ -n "$extensionless_imports" ]]; then
    printf 'error: relative imports in packages/ and the web function sources must end in .js (Node ESM cannot load them compiled otherwise):\n%s\n' \
        "$extensionless_imports" >&2
    exit 1
fi

# The web functions are bundled from server/routes/ into dist-functions/ and
# the Build Output tree with every workspace package inlined, so a bare
# `@luke/…` specifier is resolved by
# esbuild at build time from apps/web's own node_modules. pnpm links there only
# what apps/web/package.json declares, so a specifier the web app's sources name
# without declaring resolves in a developer's hoisted tree, typechecks, and
# fails the deploy's bundle step, or, for the Vite client, ships a bundle that
# happened to resolve through another package's link. Declare what is named.
# The two eve services (apps/luke and apps/dev) are workspaces of their own,
# each a Vercel service root installed from its own manifest, so each is held
# to what it declares on the same terms.
undeclared_packages() {
    local manifest=$1
    shift
    local declared named named_name undeclared=""
    declared=$(grep -oE '"@luke/[a-z-]+": "workspace:\*"' "$manifest" |
        sed -E 's#"@luke/([a-z-]+)".*#\1#' | sort -u)
    named=$(grep -rhoE --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' \
        '(from|import) "@luke/[a-z-]+(/[a-z-]+)*"' "$@" |
        sed -E 's#.*"@luke/([a-z-]+).*"#\1#' | sort -u || true)
    while IFS= read -r named_name; do
        [[ -z "$named_name" ]] && continue
        if ! grep -qx "$named_name" <<<"$declared"; then
            undeclared+="$named_name"$'\n'
        fi
    done <<<"$named"
    printf '%s' "$undeclared"
}
undeclared_web_packages=$(undeclared_packages "$LUKE_REPO_ROOT/apps/web/package.json" \
    "$LUKE_REPO_ROOT/apps/web/server" "$LUKE_REPO_ROOT/apps/web/src" "$LUKE_REPO_ROOT/apps/web/scripts")
for service in apps/luke apps/dev; do
    undeclared_service_packages=$(undeclared_packages "$LUKE_REPO_ROOT/$service/package.json" \
        "$LUKE_REPO_ROOT/$service")
    if [[ -n "$undeclared_service_packages" ]]; then
        undeclared_web_packages+="$service: $undeclared_service_packages"
    fi
done
if [[ -n "$undeclared_web_packages" ]]; then
    printf 'error: apps/web names workspace packages its package.json does not declare (the function bundle resolves bare @luke specifiers from apps/web/node_modules, which pnpm links from the declared dependencies alone):\n%s\n' \
        "$undeclared_web_packages" >&2
    exit 1
fi

# Packages must not reach into apps: the dependency points the other way, and
# a relative path into apps/ evades the declared package graph, so typecheck
# resolves it without seeing the package → app → package cycle it creates.
# Every name the app re-exports originates in a package; import it from the
# defining package instead.
package_app_imports=$(grep -rEn '(from|import) "[^"]*apps/[^"]*"' \
    "$LUKE_REPO_ROOT"/packages/*/src || true)
if [[ -n "$package_app_imports" ]]; then
    printf 'error: packages must not import from apps/ (the path import hides a package → app → package cycle from the declared dependency graph):\n%s\n' \
        "$package_app_imports" >&2
    exit 1
fi

# The renderer is a sandboxed browser context: it reaches the main process
# through the preload bridge alone, so `@luke/host/bridge`, `#shared/messages/*`,
# and the packages' own wire vocabularies are its widest doors. A `#main/` import compiles and bundles happily and then fails in the
# browser, and a `node:` import does the same — neither is a mistake the type
# checker or esbuild can report, because both are real modules that simply are
# not there at run time.
#
# A colocated test is not the renderer: it runs under Node and never enters
# the bundle, so a `node:assert` import is its whole point. The main-process
# door stays shut for it either way — a renderer test that needs main is
# testing the wrong side.
renderer_escapes=$(grep -ranE 'from "(#main/|node:)' "$LUKE_REPO_ROOT/apps/desktop/src/renderer" |
    grep -vE '\.test\.tsx?:[0-9]+:import .*"node:' || true)
if [[ -n "$renderer_escapes" ]]; then
    printf 'error: the renderer is sandboxed — it reaches the main process only through the shared bridge and wire modules:\n%s\n' \
        "$renderer_escapes" >&2
    exit 1
fi

# `@luke/ui` is mounted by more than one app, so it reaches none of them: the
# desktop's preload bridge and its `#shared/`, `#renderer/`, and `#main/`
# aliases resolve inside the desktop alone, and a component that reads one
# typechecks there and breaks in every other app that mounts it.
ui_app_reaches=$(grep -rnaE 'window\.luke|"#(shared|renderer|main)/' \
    "$LUKE_REPO_ROOT/packages/ui/src" || true)
if [[ -n "$ui_app_reaches" ]]; then
    printf 'error: @luke/ui reaches into an app (take the value as a prop and let the app that mounts the component read it):\n%s\n' \
        "$ui_app_reaches" >&2
    exit 1
fi

# A hosted quota is the service's own accounting, and the customer-facing panel
# says only that voice is temporarily unavailable — never a number, a meter or a
# reset time. The diagnostics the renderer receives carry the members, so the
# rule is that nothing drawn reads them.
drawn_hosted_quota=$(grep -rnaE --include='*.ts' --include='*.tsx' \
    'requestHostedUsage|hostedUsage|<meter\b|quota\.(used|limit|remaining|resetsAt)' \
    "$LUKE_REPO_ROOT/apps/desktop/src/renderer" |
    grep -vE '\.test\.tsx?:' || true)
if [[ -n "$drawn_hosted_quota" ]]; then
    printf 'error: hosted quota values must not reach the customer-facing renderer:\n%s\n' \
        "$drawn_hosted_quota" >&2
    exit 1
fi

# A temporary directory, a native-helper process, and a brain composition were
# each hand-rolled in several test files, and every copy drifted: three
# temporary directories were never cleaned up. `temporaryDirectory` lives in
# @luke/runtime/testing, because the host's tests are in a package and a
# package cannot reach into an app; the rest are under apps/desktop/src/testing.
# This call is how a hand-rolled one always begins. A microtask drain and a
# fake clock are no longer this check's concern: `TestClock` is the clock an
# `it.effect` test drives, and a plain vitest test's own wait is a
# package-owned helper beside the suite that needs it, never a shared runtime
# export.
hand_rolled_fixtures=$(grep -rnaE --include='*.test.ts' --include='*.test.tsx' \
    'mkdtemp' \
    "$LUKE_REPO_ROOT/apps/desktop/src" "$LUKE_REPO_ROOT/packages/host/src" || true)
if [[ -n "$hand_rolled_fixtures" ]]; then
    printf 'error: test files import temporaryDirectory from @luke/runtime/testing rather than hand-rolling it:\n%s\n' \
        "$hand_rolled_fixtures" >&2
    exit 1
fi

# BRIDGE is the one renderer-to-main declaration, and registerBridgeHost is
# the one place that may attach it to Electron. A handler registered beside its
# domain logic would bypass the manifest's sender and wire guards, and an act
# registered on a channel of its own would bypass the router.
direct_ipc_registration=$(grep -rnaE --exclude-dir=node_modules --include='*.ts' 'ipcMain\.(handle|on)\(' \
    "$LUKE_REPO_ROOT/apps/desktop/src" |
    grep -v '/main/bridge-host.ts:' || true)
if [[ -n "$direct_ipc_registration" ]]; then
    printf 'error: Electron IPC handlers must be registered through registerBridgeHost:\n%s\n' \
        "$direct_ipc_registration" >&2
    exit 1
fi

# The changelog page splits releases on "## <version> — <YYYY-MM-DD>" and its
# parser throws on any other shape — at module load in the browser, which no
# build step executes. This check is what keeps a malformed heading out of a
# visitor's tab.
malformed_release_headings=$(grep -E '^## ' "$LUKE_REPO_ROOT/CHANGELOG.md" |
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
desktop_version=$(node -p "require('$LUKE_REPO_ROOT/apps/desktop/package.json').version")
if ! grep -Eq "^## ${desktop_version//./\\.}( |$)" "$LUKE_REPO_ROOT/CHANGELOG.md"; then
    printf 'error: CHANGELOG.md has no entry for version %s — every release adds its notes before its tag is pushed\n' \
        "$desktop_version" >&2
    exit 1
fi

# Effect's Context.Service identity is per module instance: two resolved copies of
# "effect" in the dependency tree mint two tags that fail their own equality
# check. The catalog is what pins every package to the one resolved version, so
# a literal version here is the one thing that can quietly reintroduce a second
# copy.
literal_effect_versions=$(grep -rnE '"effect": *"[^c]' --include=package.json \
    --exclude-dir=node_modules \
    "$LUKE_REPO_ROOT/apps" "$LUKE_REPO_ROOT/packages" "$LUKE_REPO_ROOT/tools" || true)
if [[ -n "$literal_effect_versions" ]]; then
    printf 'error: "effect" must be declared as "catalog:", never a literal version:\n%s\n' \
        "$literal_effect_versions" >&2
    exit 1
fi

# `tools/anti-slop/effect-edges.json` is the machine-readable twin of
# root AGENTS.md's "Effect idioms" section: `no-run-promise-outside-edges` and
# `no-raw-async-primitives` read it, so the lint itself is what catches a file
# that starts running an Effect without being written down. This is the other
# direction — an entry that outlived the code it was written for. A deletion PR
# that takes the run out and leaves the row, or takes the AGENTS.md paragraph
# out and leaves the row, fails here rather than shrinking the allowlist by
# half.
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  import path from "node:path";
  const root = process.argv[1];
  const allowlistPath = "tools/anti-slop/effect-edges.json";
  const allowlist = JSON.parse(await readFile(path.join(root, allowlistPath), "utf8"));
  const agents = await readFile(path.join(root, "AGENTS.md"), "utf8");
  const section = agents.slice(
    agents.indexOf("## Effect idioms"),
    agents.indexOf("## TypeScript"),
  );
  // The same runners `no-run-promise-outside-edges` bans, spelled as a regex
  // because this check reads text rather than an AST. Keep the two in step:
  // v4 removed `Runtime<R>`, so what a caller used to carry as a runtime it
  // hands to a `run*With` instead, and the `Runtime` namespace is down to
  // `makeRunMain`. Longest alternative first, so `runPromiseExitWith` is not
  // read as a `runPromise` that failed to be followed by its parenthesis.
  const stillRuns =
    /\b(?:Effect|ManagedRuntime)\.run(?:PromiseExit|Promise|SyncExit|Sync|Fork|Callback)(?:With)?\s*\(|\bManagedRuntime\.make\s*\(|\b(?:Runtime\.makeRunMain|NodeRuntime\.runMain)\s*\(|\b(?:runtimeExit|detachOn|runWeb)\s*\(/;
  const stillPrimitive = /\b(?:setTimeout|setInterval|watch)\s*\(|new\s+(?:Promise|AbortController)\b/;
  const groups = [
    { name: "runtimeEdges", named: true, pattern: null },
    { name: "runShims", named: true, pattern: stillRuns },
    { name: "runOnHandedRuntime", named: true, pattern: stillRuns },
    { name: "rawAsyncPrimitives", named: false, pattern: stillPrimitive },
  ];
  const offenders = [];
  for (const group of groups) {
    const entries = allowlist[group.name];
    if (!Array.isArray(entries)) {
      offenders.push(`${allowlistPath}: no "${group.name}" list`);
      continue;
    }
    for (const entry of entries) {
      const text = await readFile(path.join(root, entry), "utf8").catch(() => null);
      if (text === null) {
        offenders.push(`${group.name}: ${entry} no longer exists`);
        continue;
      }
      // The whole path, never a tail of it: a basename lets two files named
      // `testing.ts` collide, so the paragraph about
      // `packages/gateway/src/testing.ts` could answer for a `testing.ts` in
      // another package that had no paragraph at all.
      // The path is also never the tail of a longer one, so `queue.effect.ts`
      // is not satisfied by a mention of
      // `packages/runtime/src/queue.effect.ts.bak`.
      const named = new RegExp(`(?<![\\w.\\-/])${entry.replaceAll(".", "\\.")}(?![\\w\\-/])`, "u");
      if (group.named && !named.test(section)) {
        offenders.push(
          `${group.name}: ${entry} is on the allowlist and AGENTS.md never names it by its whole path`,
        );
      }
      if (group.pattern !== null && !group.pattern.test(text)) {
        offenders.push(`${group.name}: ${entry} no longer holds what it was allowed for`);
      }
    }
  }
  if (offenders.length > 0) {
    process.stderr.write(
      `error: ${allowlistPath} and AGENTS.md have drifted apart:\n${offenders.join("\n")}\n`,
    );
    process.exit(1);
  }
' "$LUKE_REPO_ROOT"

# Application logic lives in `packages/` (AGENTS.md's "Layout"). A `.ts`
# module under an app that imports nothing of its app (`./`, `../`, a `#`
# import) and no platform library, and names no DOM global, could run on any
# platform, so it is logic and belongs in a package. Shell is stated by role
# rather than by list: an app's entries in `knip.json`, its runtime edges in
# `effect-edges.json`, and the deployment and test-support files named here.
# The agents' eve apps are scanned on the same terms: eve's file conventions
# import `eve`, a platform, and their build and dependency trees are skipped.
# The source is parsed with the root's `typescript`, so a comment or a string
# that says "window" is not a reach into the DOM. `react` is deliberately not
# a platform, so a DOM-free hook is flagged and belongs in `@luke/ui`; a
# `.tsx` component is placed by review, because a site-only component and a
# shareable one look the same to a parser. There is no baseline: moving a leaf
# exposes the next layer, so the check ratchets without one.
node --input-type=module -e '
  import { glob, readFile } from "node:fs/promises";
  import { createRequire } from "node:module";
  import path from "node:path";
  const root = process.argv[1];
  const ts = createRequire(path.join(root, "package.json"))("typescript");
  const SCANNED = ["apps/desktop/src", "apps/web/src", "apps/web/server", "apps/luke", "apps/dev"];
  const APP_MODULE = /^(?:\.{1,2}\/|#(?:main|renderer|shared|preload|testing)\/)/;
  const PLATFORM =
    /^(?:electron|electron-updater|@sentry\/electron|react-dom|better-auth|@better-auth\/[^/]+|eve|@vercel\/[^/]+|vite|@tailwindcss\/[^/]+|posthog-js|@fontsource[^/]*(?:\/[^/]+)?)(?:\/.*)?$/;
  const DOM_GLOBALS = new Set([
    "window", "document", "navigator", "location", "history", "screen", "localStorage",
    "sessionStorage", "customElements", "devicePixelRatio", "getComputedStyle", "matchMedia",
    "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "Element", "Node",
    "Document", "DocumentFragment", "Window", "Range", "Selection", "DOMRect", "DOMParser",
    "CSSStyleDeclaration", "ResizeObserver", "MutationObserver", "IntersectionObserver",
    "KeyboardEvent", "MouseEvent", "PointerEvent", "DragEvent", "ClipboardEvent", "FocusEvent",
    "WheelEvent", "InputEvent", "TouchEvent", "UIEvent", "Image", "Audio", "AudioContext",
    "AudioWorkletNode", "MediaStream", "MediaRecorder", "RTCPeerConnection", "IDBDatabase",
    "indexedDB", "FileReader", "DataTransfer",
  ]);
  const ELEMENT_TYPE = /^(?:HTML|SVG)\w*Element$/;
  // A DOM global is a name the checker resolves to `lib.dom`, so a local
  // that shadows one in its own scope (a plan `document`, say) is not a reach
  // into the DOM, while `globalThis.location` is. The set narrows `lib.dom`
  // to what only a browser has, because Node shares `fetch`, `URL`, `Event`.
  const reachesDom = (checker, node) => {
    if (!DOM_GLOBALS.has(node.text) && !ELEMENT_TYPE.test(node.text)) return false;
    const symbol = checker.getSymbolAtLocation(node);
    const declarations = symbol?.declarations ?? [];
    return declarations.length > 0 &&
      declarations.every((one) => path.basename(one.getSourceFile().fileName) === "lib.dom.d.ts");
  };
  // Shell, stated by role: the knip entries of each app, the runtime edges,
  // and the deployment and test-support files named here.
  const knip = JSON.parse(await readFile(path.join(root, "knip.json"), "utf8"));
  const edges = JSON.parse(await readFile(path.join(root, "tools/anti-slop/effect-edges.json"), "utf8"));
  const shellGlobs = [
    ...["apps/desktop", "apps/web", "apps/luke", "apps/dev"].flatMap((app) =>
      (knip.workspaces[app]?.entry ?? []).map((entry) => `${app}/${entry}`),
    ),
    "apps/web/server/function-*.ts",
    "apps/web/server/build-output.ts",
    "apps/web/server/api-callers.ts",
    "apps/web/server/preview-*.ts",
    "apps/desktop/src/renderer/stylesheet.d.ts",
    "apps/desktop/src/testing/**",
    // The doors the window root installs its platform bridge and platform
    // services into. Step 16 of the web plan moves them into the panel
    // package, together with renderer/act.ts and the hooks above them, and
    // removes these rows.
    "apps/desktop/src/renderer/app-bridge.ts",
    "apps/desktop/src/renderer/app-platform.ts",
  ];
  const shell = new Set(edges.runtimeEdges);
  for await (const found of glob(shellGlobs, { cwd: root })) shell.add(found.split(path.sep).join("/"));
  const candidates = [];
  for await (const found of glob(SCANNED.map((dir) => `${dir}/**/*.ts`), { cwd: root })) {
    const file = found.split(path.sep).join("/");
    if (/\.test\.ts$/.test(file) || /\/(?:__tests__|tests)\//.test(file) || shell.has(file)) continue;
    if (/\/(?:node_modules|\.eve|\.vercel|\.output)\//.test(file)) continue;
    candidates.push(file);
  }
  // One program over every candidate, resolving no import, so the checker
  // binds each file against the DOM library and nothing else.
  const program = ts.createProgram(candidates.map((file) => path.join(root, file)), {
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
    noResolve: true,
    noEmit: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const offenders = [];
  for (const file of candidates) {
    const source = program.getSourceFile(path.join(root, file));
    let anchored = false;
    const visit = (node) => {
      const specifier =
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier :
        (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) ? node.arguments[0] :
        ts.isImportTypeNode(node) ? node.argument?.literal :
        undefined;
      if (specifier && ts.isStringLiteralLike(specifier) &&
          (APP_MODULE.test(specifier.text) || PLATFORM.test(specifier.text))) anchored = true;
      if (ts.isIdentifier(node) && reachesDom(checker, node)) anchored = true;
      if (!anchored) ts.forEachChild(node, visit);
    };
    visit(source);
    if (!anchored) offenders.push(file);
  }
  if (offenders.length > 0) {
    process.stderr.write(
      `error: these modules under apps/ import nothing of their app and no platform library, so they are logic and belong in a package (@luke/ui, @luke/service, @luke/features, @luke/host, @luke/wire); a module is shell only as an app entry in knip.json, a runtimeEdges row in tools/anti-slop/effect-edges.json, or a deployment or test-support file named in scripts/repository-checks.sh:\n${offenders.sort().map((one) => `  ${one}`).join("\n")}\n`,
    );
    process.exit(1);
  }
' "$LUKE_REPO_ROOT"

# The root `vitest.config.ts` names every workspace with tests, which is what
# `pnpm exec vitest run <path>` from the root reads, and each of those
# workspaces runs its tests through turbo under a name in `lib/turbo.mjs`'s
# TEST_TASKS, which is what the checks and CI ask turbo for. A workspace that
# gains a `vitest.config.ts` and is left off the list, or whose tests are under
# no such name, has tests nothing runs, and CI stays green over them; one that
# loses its config and stays on the list fails the run outright. All three are
# the same drift. A suite cut into shards must declare every shard, or the
# files hashed to the missing one never run.
node --input-type=module -e '
  import { glob, readFile } from "node:fs/promises";
  import path from "node:path";
  const root = process.argv[1];
  const { TEST_TASKS } = await import(path.join(root, "scripts/lib/turbo.mjs"));
  const [WHOLE, ...SHARDS] = TEST_TASKS;
  const configured = [];
  for await (const found of glob(["apps/*/vitest.config.ts", "packages/*/vitest.config.ts", "tools/*/vitest.config.ts"], { cwd: root })) {
    configured.push(path.dirname(found).split(path.sep).join("/"));
  }
  const rootConfig = await readFile(path.join(root, "vitest.config.ts"), "utf8");
  const projects = rootConfig.slice(rootConfig.indexOf("projects: ["), rootConfig.indexOf("],", rootConfig.indexOf("projects: [")));
  const listed = [...projects.matchAll(/"([^"]+)"/gu)].map((match) => match[1]);
  const missing = configured.filter((one) => !listed.includes(one)).sort();
  const stale = listed.filter((one) => !configured.includes(one)).sort();
  const untasked = [];
  for (const one of configured.sort()) {
    const scripts = JSON.parse(await readFile(path.join(root, one, "package.json"), "utf8")).scripts ?? {};
    const named = Object.keys(scripts).filter((script) => script.startsWith(WHOLE));
    const whole = named.length === 1 && named[0] === WHOLE;
    const sharded = named.length === SHARDS.length && SHARDS.every((shard) => named.includes(shard));
    if (!whole && !sharded) untasked.push(one);
  }
  if (missing.length > 0 || stale.length > 0 || untasked.length > 0) {
    process.stderr.write(
      `error: the root vitest.config.ts projects list, the workspaces holding a vitest.config.ts, and their turbo test tasks have drifted apart:\n${[
        ...missing.map((one) => `  ${one} has a vitest.config.ts and the list never names it, so nothing runs its tests`),
        ...stale.map((one) => `  ${one} is on the list and holds no vitest.config.ts`),
        ...untasked.map((one) => `  ${one} runs its tests under neither "${WHOLE}" alone nor all of ${SHARDS.map((shard) => `"${shard}"`).join(", ")}, so the checks and CI never run them`),
      ].join("\n")}\n`,
    );
    process.exit(1);
  }
' "$LUKE_REPO_ROOT"

# `@effect/platform-node` and `effect/sql` reach `node:` modules, so an import
# of either compiles and bundles happily and then fails where there is no Node:
# the sandboxed renderer. The renderer's `node:` grep above catches the direct
# reach; this catches the Effect layer that would carry it in behind a bare
# specifier. (A web function inlines its whole graph and runs on Node, and the
# isolation guard in apps/web/tests/build-output.test.ts is what proves each one
# loads.)
node_reaching_effect=$(grep -rEn --include='*.ts' --include='*.tsx' \
    '"(@effect/platform-node|effect/sql)' \
    "$LUKE_REPO_ROOT/apps/desktop/src/renderer" || true)
if [[ -n "$node_reaching_effect" ]]; then
    printf 'error: @effect/platform-node and effect/sql reach node: modules and must not be imported by the renderer — put the layer behind the runtime edge that builds it:\n%s\n' \
        "$node_reaching_effect" >&2
    exit 1
fi

# This is the one scan for secrets the repository runs (AGENTS.md's "Never"), and
# a test fixture shaped like a provider's live credential is what GitHub's
# secret scanning raises an alert on, which history keeps open once pushed. So
# a tracked file may hold no literal in the shape of a live provider key, a
# GitHub token, a Slack token, an AWS access key id, or a private key block:
# a test that needs one builds it at run time or uses a low-entropy fake.
# Note that git grep answers 1 for no match and more for a scan that failed,
# which must fail the check rather than pass it, and that a hit is named by its
# file and line alone, so the literal never reaches a CI log.
provider_shaped_status=0
provider_shaped_literals=$(git -C "$LUKE_REPO_ROOT" grep -nIE \
    -e 'sk_live_[0-9A-Za-z]{24,}' \
    -e 'gh[pousr]_[A-Za-z0-9]{36}' \
    -e 'github_pat_[A-Za-z0-9_]{22,}' \
    -e 'xox[baprs]-[0-9]+-' \
    -e 'AKIA[0-9A-Z]{16}' \
    -e '-----BEGIN [A-Z ]*PRIVATE KEY-----' | cut -d: -f1,2) || provider_shaped_status=$?
if ((provider_shaped_status > 1)); then
    printf 'error: the scan for provider-shaped literals could not run (git grep exited %s)\n' \
        "$provider_shaped_status" >&2
    exit 1
fi
if [[ -n "$provider_shaped_literals" ]]; then
    printf 'error: a tracked file holds a literal shaped like a provider credential; use a low-entropy fake or build the value at run time:\n%s\n' \
        "$provider_shaped_literals" >&2
    exit 1
fi

printf 'Repository contract checks passed.\n'
