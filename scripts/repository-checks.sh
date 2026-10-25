#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

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
# `@luke/host` and every door of it a browser loads are walked the same way:
# `/effect`, `/client`, `/act-port`, `/service-layer`, `/agent-notices` and
# `/task-code`, which the web app runs the host in a tab through, and
# `/acts`, `/app-state`, `/bridge` and `/contract`, which the panel reads
# (`packages/host/AGENTS.md`). Their graphs name no `node:` module, no `ws`, no
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
      name: "@luke/host and the doors of it a browser loads",
      root: "packages/host/src",
      entries: [
        "index.ts",
        "effect/index.ts",
        "client/index.ts",
        "act-port/index.ts",
        "service-layer.ts",
        "agent-notices.ts",
        "acts.ts",
        "app-state.ts",
        "bridge.ts",
        "contract/index.ts",
        "task-code.ts",
      ],
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

# The vercel.json rewrites are what land a route on its grouped function, and
# they are generated from server/routes/ and the functions, ending in the one
# fallback onto the hosted oRPC route; --check fails if a rewrite went stale.
pnpm --dir "$LUKE_REPO_ROOT/apps/web" exec tsx scripts/function-rewrites.ts --check

# The constants clients build /api/ URLs from are the other half of that
# table: a path constant can outlive its route and nothing fails until
# production answers 404 (LUKE-186). Every /api/ literal and path builder under
# apps/desktop/src, packages/*/src, scripts, and tools must resolve to an
# extensionless alias the Build Output emits, a rewrite of the table ahead of
# its fallback, or a procedure of the hosted oRPC contract; the fallback alone
# resolves nothing, since a path no procedure matches is the router's 404.
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

# The web functions are bundled from server/routes/ and server/orpc-route.ts
# into dist-functions/ and
# the Build Output tree with every workspace package inlined, so a bare
# `@luke/…` specifier is resolved by
# esbuild at build time from apps/web's own node_modules. pnpm links there only
# what apps/web/package.json declares, so a specifier the web app's sources name
# without declaring resolves in a developer's hoisted tree, typechecks, and
# fails the deploy's bundle step, or, for the Vite client, ships a bundle that
# happened to resolve through another package's link. Declare what is named.
# The eve service (apps/dev) is a workspace of its own, a Vercel service
# root installed from its own manifest, so it is held to what it declares on
# the same terms.
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
for service in apps/dev; do
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
renderer_escapes=$(grep -ranE 'from "(#main/|node:)' \
    "$LUKE_REPO_ROOT/apps/desktop/src/renderer" "$LUKE_REPO_ROOT/packages/panel/src" |
    grep -vE '\.test\.tsx?:[0-9]+:import .*"node:' || true)
if [[ -n "$renderer_escapes" ]]; then
    printf 'error: the renderer is sandboxed — it reaches the main process only through the shared bridge and wire modules:\n%s\n' \
        "$renderer_escapes" >&2
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

# The root `vitest.config.ts` names every workspace with tests, which is what
# `pnpm exec vitest run <path>` from the root reads, and each of those
# workspaces runs its tests through turbo under `lib/turbo.mjs`'s TEST_TASK,
# which is what the checks and CI ask turbo for. A workspace that gains a
# `vitest.config.ts` and is left off the list, or whose tests are under no
# such name, has tests nothing runs, and CI stays green over them; one that
# loses its config and stays on the list fails the run outright. All three are
# the same drift. CI's job for the whole task may leave a workspace out with
# `--filter=!<name>` only where another job in `ci.yml` runs that task for it
# alone with `--filter=<name>`, and no job may run one the whole task's job
# still runs, so each workspace's tests run in exactly one job. A workspace
# cut into vitest shards (`-- --shard=<i>/<n>`) runs in one job per shard,
# and must run in every shard of one set, or the files hashed to the missing
# one never run.
node --input-type=module -e '
  import { glob, readFile } from "node:fs/promises";
  import path from "node:path";
  const root = process.argv[1];
  const { TEST_TASK: WHOLE } = await import(path.join(root, "scripts/lib/turbo.mjs"));
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
  const wholeNames = [];
  for (const one of configured.sort()) {
    const scripts = JSON.parse(await readFile(path.join(root, one, "package.json"), "utf8")).scripts ?? {};
    const named = Object.keys(scripts).filter((script) => script.startsWith(WHOLE));
    const whole = named.length === 1 && named[0] === WHOLE;
    if (!whole) untasked.push(one);
    if (whole) wholeNames.push(JSON.parse(await readFile(path.join(root, one, "package.json"), "utf8")).name);
  }
  const workflow = await readFile(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const excluded = [];
  const alone = new Map();
  let shardedWhole = false;
  for (const [, filters, index, count] of workflow.matchAll(new RegExp(WHOLE + "((?:[ \\t]+--filter=\\S+)+)(?:[ \\t]+--[ \\t]+--shard=(\\d+)/(\\d+))?", "gu"))) {
    for (const [, negated, name] of filters.matchAll(/--filter=(!?)(\S+)/gu)) {
      if (negated) {
        excluded.push(name);
        if (index) shardedWhole = true;
      } else {
        alone.set(name, [...(alone.get(name) ?? []), index ? `${index}/${count}` : "whole"]);
      }
    }
  }
  const unrun = excluded.filter((name) => !alone.has(name));
  const doubled = [...alone.keys()].filter((name) => !excluded.includes(name));
  const unknown = [...new Set([...excluded, ...alone.keys()])].filter((name) => !wholeNames.includes(name));
  const unsharded = [];
  for (const [name, runs] of alone) {
    const count = Number(runs[0].split("/")[1]) || 1;
    const expected = count === 1 ? ["whole"] : Array.from({ length: count }, (_, at) => `${at + 1}/${count}`);
    if (runs.length !== expected.length || !expected.every((run) => runs.includes(run))) unsharded.push([name, runs]);
  }
  if (missing.length > 0 || stale.length > 0 || untasked.length > 0 || unrun.length > 0 || doubled.length > 0 || unknown.length > 0 || unsharded.length > 0 || shardedWhole) {
    process.stderr.write(
      `error: the root vitest.config.ts projects list, the workspaces holding a vitest.config.ts, and their turbo test tasks have drifted apart:\n${[
        ...missing.map((one) => `  ${one} has a vitest.config.ts and the list never names it, so nothing runs its tests`),
        ...stale.map((one) => `  ${one} is on the list and holds no vitest.config.ts`),
        ...untasked.map((one) => `  ${one} declares no "${WHOLE}" script, or another "${WHOLE}…" one beside it, so the checks and CI never run some of its tests`),
        ...unrun.map((name) => `  .github/workflows/ci.yml leaves ${name} out of the "${WHOLE}" job and no job runs "${WHOLE} --filter=${name}", so CI never runs its tests`),
        ...doubled.map((name) => `  .github/workflows/ci.yml runs "${WHOLE} --filter=${name}" in a job of its own and never leaves ${name} out of the "${WHOLE}" job, so CI runs its tests twice`),
        ...unknown.map((name) => `  .github/workflows/ci.yml filters "${WHOLE}" by ${name}, which names no workspace running its tests under "${WHOLE}" alone`),
        ...unsharded.map(([name, runs]) => `  .github/workflows/ci.yml runs "${WHOLE} --filter=${name}" as ${runs.join(", ")}, which is neither one whole job nor every shard of one set once, so CI runs some of its tests twice or never`),
        ...(shardedWhole ? [`  .github/workflows/ci.yml shards the job that leaves workspaces out with "--filter=!", which only a job for one workspace may do`] : []),
      ].join("\n")}\n`,
    );
    process.exit(1);
  }
' "$LUKE_REPO_ROOT"

# Turbo's global hash covers the lockfile, `globalDependencies`, `globalEnv`
# values and its own flags, and no OS, CPU architecture, or Node version, so a
# check that passed on one platform would replay as a pass on another.
# `lib/turbo.mjs` names the platform in `LUKE_TURBO_PLATFORM` and `turbo.json`
# hashes it through `globalEnv`; this holds both halves. The first asks turbo
# for one task's hash, which its dry run documents as the key it caches under,
# under two values of the variable; the second asks the wrapper what it sets.
node --input-type=module -e '
  import { execFileSync } from "node:child_process";
  import path from "node:path";
  const root = process.argv[1];
  const { turboInvocation } = await import(path.join(root, "scripts/lib/turbo.mjs"));
  const TASK = "@luke/wire#typecheck";
  const hashUnder = (platform) => {
    const { TURBO_TOKEN, ...env } = process.env;
    const dry = execFileSync("pnpm", ["exec", "turbo", "run", "typecheck", "--filter=@luke/wire", "--dry=json"], {
      cwd: root,
      env: { ...env, LUKE_TURBO_PLATFORM: platform, TURBO_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
    });
    return JSON.parse(dry).tasks.find((task) => task.taskId === TASK)?.hash;
  };
  const errors = [];
  const linux = hashUnder("linux-x64-node24");
  const darwin = hashUnder("darwin-arm64-node24");
  if (!linux || linux === darwin) {
    errors.push(`  turbo hashes ${TASK} the same under two values of LUKE_TURBO_PLATFORM, so turbo.json does not name it in globalEnv`);
  }
  const expected = `${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}`;
  const set = turboInvocation([]).env.LUKE_TURBO_PLATFORM;
  if (set !== expected) {
    errors.push(`  lib/turbo.mjs starts turbo with LUKE_TURBO_PLATFORM=${set}, not ${expected}`);
  }
  if (errors.length > 0) {
    process.stderr.write(`error: turbo cache hits would cross platforms:\n${errors.join("\n")}\n`);
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
    "$LUKE_REPO_ROOT/apps/desktop/src/renderer" "$LUKE_REPO_ROOT/packages/panel/src" || true)
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
