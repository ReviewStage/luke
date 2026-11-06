#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIRECTORY=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=scripts/lib/workspace.sh
source "$SCRIPT_DIRECTORY/lib/workspace.sh"

nvmrc_major=$(sed -E 's/^v?([0-9]+).*$/\1/' "$APP_REPO_ROOT/.nvmrc" | head -1)
engines_drift=""
for manifest in "$APP_REPO_ROOT/package.json" \
    "$APP_REPO_ROOT"/apps/*/package.json \
    "$APP_REPO_ROOT"/packages/*/package.json; do
    declared=$(node -e 'const n = require(process.argv[1]).engines?.node; if (n) process.stdout.write(n)' \
        "$manifest")
    if [[ -z "$declared" ]]; then
        continue
    fi
    declared_major=$(printf '%s' "$declared" | grep -oE '[0-9]+' | head -1)
    if [[ "$declared_major" != "$nvmrc_major" ]]; then
        engines_drift+="${manifest#"$APP_REPO_ROOT/"}: engines.node \"$declared\" is not Node $nvmrc_major"$'\n'
    fi
done
if [[ -n "$engines_drift" ]]; then
    printf 'error: every engines.node must name the Node major .nvmrc pins (%s):\n%s' \
        "$nvmrc_major" "$engines_drift" >&2
    exit 1
fi

node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  import path from "node:path";
  const doors = [
    {
      name: "@repo/runtime/vocabulary",
      root: "packages/runtime/src",
      entries: ["vocabulary.ts"],
      forbidden: /^(node:|@effect\/platform-node|effect\/sql)/,
    },
    {
      name: "@repo/host and the doors of it a browser loads",
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
      forbidden: /^(node:|ws$|electron$|@effect\/platform-node|@repo\/host\/node)/,
      globals: /\b(Buffer|process)\.\w+/,
      follows: ["@repo/credentials", "@repo/sync"],
    },
  ];
  const repository = process.argv[1];
  // A followed package is entered where its own `exports` says the
  // specifier lands, so the walk takes the same door a resolver would.
  const followed = async (door, specifier) => {
    const name = door.follows?.find((pkg) => specifier === pkg || specifier.startsWith(`${pkg}/`));
    if (!name) return undefined;
    const directory = path.join(repository, "packages", name.slice("@repo/".length));
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
' "$APP_REPO_ROOT"

pnpm --dir "$APP_REPO_ROOT/apps/web" exec tsx scripts/function-rewrites.ts --check

pnpm --dir "$APP_REPO_ROOT/packages/settings" exec tsx scripts/shortcuts-docs.ts --check

pnpm --dir "$APP_REPO_ROOT/apps/web" exec tsx scripts/api-callers.ts

extensionless_imports=$(grep -rEn '(from|import) "\.\.?/[^"]*"' \
    "$APP_REPO_ROOT"/packages/*/src \
    "$APP_REPO_ROOT"/apps/web/server |
    grep -vE '\.(js|css)"|\?raw"' || true)
if [[ -n "$extensionless_imports" ]]; then
    printf 'error: relative imports in packages/ and the web function sources must end in .js (Node ESM cannot load them compiled otherwise):\n%s\n' \
        "$extensionless_imports" >&2
    exit 1
fi

undeclared_packages() {
    local manifest=$1
    shift
    local declared named named_name undeclared=""
    declared=$(grep -oE '"@repo/[a-z-]+": "workspace:\*"' "$manifest" |
        sed -E 's#"@repo/([a-z-]+)".*#\1#' | sort -u)
    named=$(grep -rhoE --include='*.ts' --include='*.tsx' --exclude='*.test.ts' --exclude='*.test.tsx' \
        '(from|import) "@repo/[a-z-]+(/[a-z-]+)*"' "$@" |
        sed -E 's#.*"@repo/([a-z-]+).*"#\1#' | sort -u || true)
    while IFS= read -r named_name; do
        [[ -z "$named_name" ]] && continue
        if ! grep -qx "$named_name" <<<"$declared"; then
            undeclared+="$named_name"$'\n'
        fi
    done <<<"$named"
    printf '%s' "$undeclared"
}
undeclared_web_packages=$(undeclared_packages "$APP_REPO_ROOT/apps/web/package.json" \
    "$APP_REPO_ROOT/apps/web/server" "$APP_REPO_ROOT/apps/web/src" "$APP_REPO_ROOT/apps/web/scripts")
if [[ -n "$undeclared_web_packages" ]]; then
    printf 'error: apps/web names workspace packages its package.json does not declare (the function bundle resolves bare @repo specifiers from apps/web/node_modules, which pnpm links from the declared dependencies alone):\n%s\n' \
        "$undeclared_web_packages" >&2
    exit 1
fi

renderer_escapes=$(grep -ranE 'from "(#main/|node:)' \
    "$APP_REPO_ROOT/apps/desktop/src/renderer" "$APP_REPO_ROOT/packages/panel/src" |
    grep -vE '\.test\.tsx?:[0-9]+:import .*"node:' || true)
if [[ -n "$renderer_escapes" ]]; then
    printf 'error: the renderer is sandboxed — it reaches the main process only through the shared bridge and wire modules:\n%s\n' \
        "$renderer_escapes" >&2
    exit 1
fi

malformed_release_headings=$(grep -E '^## ' "$APP_REPO_ROOT/CHANGELOG.md" |
    grep -vE '^## [0-9]+\.[0-9]+\.[0-9]+ — [0-9]{4}-[0-9]{2}-[0-9]{2}$' || true)
if [[ -n "$malformed_release_headings" ]]; then
    printf 'error: CHANGELOG.md release headings must read "## <version> — <YYYY-MM-DD>":\n%s\n' \
        "$malformed_release_headings" >&2
    exit 1
fi

literal_effect_versions=$(grep -rnE '"effect": *"[^c]' --include=package.json \
    --exclude-dir=node_modules \
    "$APP_REPO_ROOT/apps" "$APP_REPO_ROOT/packages" "$APP_REPO_ROOT/tools" || true)
if [[ -n "$literal_effect_versions" ]]; then
    printf 'error: "effect" must be declared as "catalog:", never a literal version:\n%s\n' \
        "$literal_effect_versions" >&2
    exit 1
fi

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
' "$APP_REPO_ROOT"

node --input-type=module -e '
  import { execFileSync } from "node:child_process";
  import path from "node:path";
  const root = process.argv[1];
  const { turboInvocation } = await import(path.join(root, "scripts/lib/turbo.mjs"));
  const TASK = "@repo/wire#typecheck";
  const hashUnder = (platform) => {
    const { TURBO_TOKEN, ...env } = process.env;
    const dry = execFileSync("pnpm", ["exec", "turbo", "run", "typecheck", "--filter=@repo/wire", "--dry=json"], {
      cwd: root,
      env: { ...env, APP_TURBO_PLATFORM: platform, TURBO_TELEMETRY_DISABLED: "1" },
      encoding: "utf8",
    });
    return JSON.parse(dry).tasks.find((task) => task.taskId === TASK)?.hash;
  };
  const errors = [];
  const linux = hashUnder("linux-x64-node24");
  const darwin = hashUnder("darwin-arm64-node24");
  if (!linux || linux === darwin) {
    errors.push(`  turbo hashes ${TASK} the same under two values of APP_TURBO_PLATFORM, so turbo.json does not name it in globalEnv`);
  }
  const expected = `${process.platform}-${process.arch}-node${process.versions.node.split(".")[0]}`;
  const set = turboInvocation([]).env.APP_TURBO_PLATFORM;
  if (set !== expected) {
    errors.push(`  lib/turbo.mjs starts turbo with APP_TURBO_PLATFORM=${set}, not ${expected}`);
  }
  if (errors.length > 0) {
    process.stderr.write(`error: turbo cache hits would cross platforms:\n${errors.join("\n")}\n`);
    process.exit(1);
  }
' "$APP_REPO_ROOT"

node_reaching_effect=$(grep -rEn --include='*.ts' --include='*.tsx' \
    '"(@effect/platform-node|effect/sql)' \
    "$APP_REPO_ROOT/apps/desktop/src/renderer" "$APP_REPO_ROOT/packages/panel/src" || true)
if [[ -n "$node_reaching_effect" ]]; then
    printf 'error: @effect/platform-node and effect/sql reach node: modules and must not be imported by the renderer — put the layer behind the runtime edge that builds it:\n%s\n' \
        "$node_reaching_effect" >&2
    exit 1
fi

(cd "$APP_REPO_ROOT" && node --import tsx tools/anti-slop/repository-guard.ts)

node --input-type=module -e '
  import { execFileSync } from "node:child_process";
  import { readFileSync } from "node:fs";
  const words = [
    "colour", "colours", "coloured", "colouring", "colourings", "colourable", "uncoloured",
    "recolour", "recolours", "recoloured", "cancelled", "cancelling", "canceller",
    "labelled", "labelling", "unlabelled", "mislabelled", "centre", "centres", "centred",
    "centring", "analyser", "neighbour", "neighbours", "neighbouring", "grey", "greys",
    "greyed", "organisation", "organisations", "organise", "organised", "travelled",
    "travelling", "signalled", "signalling", "behaviour", "behaviours", "honour", "honours",
    "honoured", "honouring", "acknowledgement", "acknowledgements", "portalled", "dialled",
    "panelled", "totalling", "modelled", "modelling", "summarise", "summarises",
    "summarised", "sanitise", "sanitised", "serialise", "serialises", "serialised",
    "recognise", "recognised", "initialise", "initialised", "parameterised", "capitalised",
    "capitalising", "virtualised", "ageing", "catalogue", "catalogues", "favour", "favoured",
    "licence",
  ];
  const cap = (word) => word[0].toUpperCase() + word.slice(1);
  const british = new RegExp(
    words
      .flatMap((word) => [
        `(?<![A-Za-z])${word}(?![a-z])`,
        `(?<![A-Z])${cap(word)}(?![a-z])`,
        `(?<![A-Z])${word.toUpperCase()}(?![A-Z])`,
      ])
      .join("|"),
  );
  const kept = /labelledBy|AnalyserNode|createAnalyser|tasks\.colourCode|["\x27`]cancelled["\x27`]|cancelled\??:|"cancelled" in/g;
  const skipped = /^(pnpm-lock\.yaml|patches\/|packages\/database\/migrations\/|packages\/agent-runner\/src\/codex-protocol\/|scripts\/repository-checks\.sh$)|\.patch$/;
  const repository = process.argv[1];
  const files = execFileSync("git", ["-C", repository, "ls-files"], { encoding: "utf8" }).split("\n");
  const offenders = [];
  for (const file of files) {
    if (file === "" || skipped.test(file)) continue;
    if (british.test(file)) offenders.push(`${file}: its name`);
    let text;
    try {
      text = readFileSync(`${repository}/${file}`, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\u0000")) continue;
    text.split("\n").forEach((line, index) => {
      const hit = line.replace(kept, "").match(british);
      if (hit) offenders.push(`${file}:${index + 1}: ${hit[0]}`);
    });
  }
  if (offenders.length > 0) {
    console.error(`error: write American spellings (color, canceled, labeled, center, gray, -ize):\n${offenders.join("\n")}`);
    process.exit(1);
  }
' "$APP_REPO_ROOT"

provider_shaped_status=0
provider_shaped_literals=$(git -C "$APP_REPO_ROOT" grep -nIE \
    -e 'sk-ant-(api03|admin01|oat01)-[A-Za-z0-9_-]{93}AA' \
    -e 'sk-proj-[A-Za-z0-9_-]{100,}' \
    -e 'AIza[0-9A-Za-z_-]{35}' \
    -e 'GOCSPX-[0-9A-Za-z_-]{28}' \
    -e '(sk|rk)_(live|test)_[0-9A-Za-z]{24,}' \
    -e 'whsec_[0-9A-Za-z+/]{32,}' \
    -e 'gh[pousr]_[A-Za-z0-9]{36}' \
    -e 'github_pat_[A-Za-z0-9_]{22,}' \
    -e 'glpat-[0-9A-Za-z_-]{20,}' \
    -e 'xox[baprs]-[0-9]+-' \
    -e 'xoxe(\.xox[bp])?-[0-9]+-[0-9A-Za-z]{40,}' \
    -e 'xapp-[0-9]+-[0-9A-Za-z]+-[0-9]+-[0-9A-Za-z]{32,}' \
    -e 'hooks\.slack\.com/services/T[0-9A-Z]{8,}/B[0-9A-Z]{8,}/[0-9A-Za-z]{24}' \
    -e 'sntrys_eyJ[0-9A-Za-z+/=_]{40,}' \
    -e 'phx_[0-9A-Za-z_]{43}' \
    -e 'lin_api_[0-9A-Za-z]{40}' \
    -e 'npm_[0-9A-Za-z]{36}' \
    -e 'npg_[0-9A-Za-z]{12}([^0-9A-Za-z_]|$)' \
    -e '(AKIA|ASIA)[0-9A-Z]{16}' \
    -e '-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----' | cut -d: -f1,2) || provider_shaped_status=$?
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
