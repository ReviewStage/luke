/**
 * bundle-budget.ts -- the gzipped size the web app's entry may reach before the build fails.
 *
 * The desktop holds its renderer to `apps/desktop/bundle-budget.json`
 * (`apps/desktop/scripts/build.mjs`); this holds the web app's entry,
 * `app.html`, to `apps/web/bundle-budget.json` on the same terms: each
 * baseline plus the budget's slack, re-recorded with
 * `LUKE_UPDATE_BUNDLE_BUDGET=1` by a pull request that says why it grew. The
 * measuring is the web's own rather than shared, because it reads Rollup's
 * bundle where the desktop reads esbuild's metafile, and the ceiling is the
 * desktop's without its Sentry floor, which no web client build carries.
 * The marketing pages are not budgeted.
 */

import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Schema } from "effect";
import type { Plugin, Rollup } from "vite";

type OutputBundle = Rollup.OutputBundle;
type OutputChunk = Rollup.OutputChunk;

/** The variable that re-records every baseline from the build instead of checking against it. */
const UPDATE_BUDGET_VARIABLE = "LUKE_UPDATE_BUNDLE_BUDGET";

/** What `bundle-budget.json` holds: the slack every baseline is allowed, and each measure's gzipped bytes. */
const BudgetSchema = Schema.Struct({
  slack: Schema.Number,
  gzipBytes: Schema.Record(Schema.String, Schema.Number),
});
const decodeBudget = Schema.decodeUnknownSync(Schema.fromJsonString(BudgetSchema));

/** Each measure's name and its gzipped bytes, in the order the budget lists them. */
type Measures = ReadonlyMap<string, number>;

/** What is measured: the entry's HTML input, and each side bundle by the module its chunk is split off at. */
interface BudgetTargets {
  /** The app's HTML input, as an absolute path, whose entry chunk Rollup builds from it. */
  readonly entry: string;
  /** Each side bundle's name in the budget, and the end of the path of the module its chunk is split off at. */
  readonly sideBundles: Readonly<Record<string, string>>;
}

/** Where the budget lives, what it measures, and the environment that says whether to re-record it. */
interface BundleBudgetOptions extends BudgetTargets {
  readonly budgetFile: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** What a check of the measures against the budget comes to. */
type BudgetOutcome =
  | { readonly kind: "within"; readonly lines: readonly string[] }
  | { readonly kind: "recorded"; readonly lines: readonly string[] }
  | { readonly kind: "breached"; readonly lines: readonly string[] };

// The budget's names for the entry's first load, as JS and as CSS.
const ENTRY_JS = "app";
const ENTRY_CSS = "app.css";

function gzippedBytes(source: string | Uint8Array): number {
  return gzipSync(source, { level: 9 }).length;
}

function chunksOf(bundle: OutputBundle): ReadonlyMap<string, OutputChunk> {
  return new Map(
    Object.values(bundle)
      .filter((file): file is OutputChunk => file.type === "chunk")
      .map((chunk) => [chunk.fileName, chunk]),
  );
}

/**
 * A chunk and every chunk it reaches through static imports, at any depth,
 * which Vite modulepreloads with it so all of them load before it runs. A
 * chunk reached only by a dynamic `import()` is fetched when that code first
 * runs, and is left out.
 */
function loadedWith(chunks: ReadonlyMap<string, OutputChunk>, start: string): ReadonlySet<string> {
  const loaded = new Set([start]);
  for (const file of loaded) {
    for (const imported of chunks.get(file)?.imports ?? []) loaded.add(imported);
  }
  return loaded;
}

function sourceOf(bundle: OutputBundle, fileName: string): string | Uint8Array {
  const file = bundle[fileName];
  if (file === undefined) throw new Error(`the bundle has no ${fileName}`);
  return file.type === "chunk" ? file.code : file.source;
}

function sumGzipped(bundle: OutputBundle, files: Iterable<string>): number {
  let total = 0;
  for (const file of files) total += gzippedBytes(sourceOf(bundle, file));
  return total;
}

/**
 * The gzipped bytes of each measure in a client bundle: the entry's first
 * load as JS (`app`) and as CSS (`app.css`), and each side bundle's bytes
 * beyond that first load, its stylesheets among them, since what the entry
 * already loaded costs nothing more when the side bundle is fetched. Each
 * file is gzipped on its own, as each is served on its own.
 *
 * Note that the entry chunk covers everything `app.html` links that Vite
 * bundles: every module script in the document is folded into the one entry,
 * and a stylesheet `<link>` becomes a stylesheet that entry imports.
 */
function measureBundle(bundle: OutputBundle, targets: BudgetTargets): Measures {
  const chunks = chunksOf(bundle);
  const entry = [...chunks.values()].find(
    (chunk) => chunk.isEntry && chunk.facadeModuleId === targets.entry,
  );
  if (entry === undefined) throw new Error(`the bundle has no entry for ${targets.entry}`);
  const firstLoad = loadedWith(chunks, entry.fileName);
  const stylesheets = stylesheetsOf(chunks, firstLoad);
  const measured = new Map([
    [ENTRY_JS, sumGzipped(bundle, firstLoad)],
    [ENTRY_CSS, sumGzipped(bundle, stylesheets)],
  ]);
  for (const [name, modulePath] of Object.entries(targets.sideBundles)) {
    // Note that the chunk is found by the modules it holds rather than by
    // its facade, because Rollup gives a dynamic entry it merges with other
    // modules (the diagram's, beside Mermaid's) no facade at all.
    const side = [...chunks.values()].find(
      (chunk) => chunk.isDynamicEntry && chunk.moduleIds.some((id) => id.endsWith(modulePath)),
    );
    if (side === undefined) throw new Error(`the bundle has no chunk for ${name} (${modulePath})`);
    const beyond = [...loadedWith(chunks, side.fileName)].filter((file) => !firstLoad.has(file));
    const sideStylesheets = [...stylesheetsOf(chunks, beyond)].filter(
      (file) => !stylesheets.has(file),
    );
    measured.set(name, sumGzipped(bundle, [...beyond, ...sideStylesheets]));
  }
  return measured;
}

/** The stylesheets a set of chunks imports, which Vite loads beside them. */
function stylesheetsOf(
  chunks: ReadonlyMap<string, OutputChunk>,
  files: Iterable<string>,
): ReadonlySet<string> {
  return new Set(
    [...files].flatMap((file) => [...(chunks.get(file)?.viteMetadata?.importedCss ?? [])]),
  );
}

/** A baseline's ceiling: the baseline plus the budget's slack, as the desktop's build without Sentry has it. */
function bundleCeiling(baseline: number, slack: number): number {
  return Math.floor(baseline * (1 + slack));
}

/**
 * The measures checked against the budget file, or written into it where the
 * environment sets `LUKE_UPDATE_BUNDLE_BUDGET=1`. A measure with no baseline
 * fails as a breach does, so a new one is recorded on purpose.
 */
async function enforceBudget(
  budgetFile: string,
  measured: Measures,
  env: Readonly<Record<string, string | undefined>>,
): Promise<BudgetOutcome> {
  const budget = decodeBudget(await readFile(budgetFile, "utf8"));
  if (env[UPDATE_BUDGET_VARIABLE] === "1") {
    await writeFile(
      budgetFile,
      `${JSON.stringify({ ...budget, gzipBytes: Object.fromEntries(measured) }, undefined, 2)}\n`,
    );
    return {
      kind: "recorded",
      lines: [...measured].map(
        ([name, bytes]) => `bundle budget recorded: ${name} ${bytes} gzipped bytes`,
      ),
    };
  }
  const errors = [...measured].flatMap(([name, bytes]) => {
    const baseline = budget.gzipBytes[name];
    if (baseline === undefined) return [`error: ${name} has no baseline in bundle-budget.json`];
    const ceiling = bundleCeiling(baseline, budget.slack);
    return bytes > ceiling
      ? [
          `error: ${name} is ${bytes} gzipped bytes, over its ceiling of ${ceiling} (baseline ${baseline} plus ${budget.slack * 100}%)`,
        ]
      : [];
  });
  if (errors.length > 0) {
    return {
      kind: "breached",
      lines: [
        ...errors,
        `Reduce the bundle, or record the new baseline with ${UPDATE_BUDGET_VARIABLE}=1 and say why in the pull request.`,
      ],
    };
  }
  return {
    kind: "within",
    lines: [...measured].map(
      ([name, bytes]) =>
        `bundle budget: ${name} ${bytes} of ${bundleCeiling(budget.gzipBytes[name] ?? 0, budget.slack)} gzipped bytes`,
    ),
  };
}

/** The client build's check of the app entry against its budget, failing the build on a breach. The SSR build is not measured. */
export function bundleBudget(options: BundleBudgetOptions): Plugin {
  let ssr = false;
  return {
    name: "bundle-budget",
    apply: "build",
    configResolved(config) {
      ssr = Boolean(config.build.ssr);
    },
    async generateBundle(_output, bundle) {
      if (ssr) return;
      const outcome = await enforceBudget(
        options.budgetFile,
        measureBundle(bundle, options),
        options.env ?? process.env,
      );
      if (outcome.kind === "breached") this.error(outcome.lines.join("\n"));
      for (const line of outcome.lines) this.info(line);
    },
  };
}
