// highlight-worker.test.mjs -- the diff highlighter's worker carries no grammar or theme set of its own, and the diff bundle reaches its script only through a chunk of its own.

import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HIGHLIGHT_WORKER_BUILD, HIGHLIGHT_WORKER_SCRIPT } from "@luke/panel/build-table";
import { build } from "esbuild";
import { test } from "vitest";

/**
 * Pierre's worker is handed every grammar and theme it highlights with by
 * the window's thread, yet bundled as written it carried all of Shiki's
 * grammars and every theme catalogue, 10.5 MB, as text inside the diff
 * bundle, which the window parsed the first time a diff was drawn. These
 * bundle the worker as the build table says and the diff bundle as a
 * splitting build does, and read what each output was made of.
 */

const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));
const DIFF_BUNDLE = path.join(REPOSITORY, "packages/panel/src/diff-view/index.ts");

// The sets the worker never loads: Shiki's grammars and themes, Highlights' themes, and Pierre's own.
const SETS =
  /node_modules\/@shikijs\/(?:langs|themes)\/|node_modules\/@pierre\/theme\/|node_modules\/@pierre\/highlights\/dist\/themes\//;

/** The relative path of a module in a metafile written from the repository's root. */
const fromRoot = (file) => path.relative(REPOSITORY, file);

test("the highlight worker carries no grammar or theme set of its own", async () => {
  const worker = await build({
    ...HIGHLIGHT_WORKER_BUILD,
    absWorkingDir: REPOSITORY,
    metafile: true,
    logLevel: "silent",
  });
  const inputs = Object.keys(worker.metafile.inputs);
  assert.ok(
    inputs.some((input) => input.includes("@pierre/diffs/dist/worker/")),
    "the worker bundles Pierre's worker, so this test reads something",
  );
  const sets = inputs.filter((input) => SETS.test(input));
  assert.deepEqual(sets, [], "a grammar or theme set rides in the worker");
});

test("the diff bundle reaches the worker's script only through a chunk it imports on demand", async () => {
  const bundle = await build({
    entryPoints: { "diff-view": DIFF_BUNDLE },
    absWorkingDir: REPOSITORY,
    outdir: path.join(REPOSITORY, "highlight-worker-test-out"),
    bundle: true,
    write: false,
    splitting: true,
    format: "esm",
    platform: "browser",
    metafile: true,
    logLevel: "silent",
  });
  const outputs = Object.values(bundle.metafile.outputs);
  const entry = outputs.find((output) => output.entryPoint === fromRoot(DIFF_BUNDLE));
  const script = fromRoot(HIGHLIGHT_WORKER_SCRIPT);
  assert.ok(entry !== undefined, "the diff bundle is an output");
  assert.equal(script in entry.inputs, false, "the worker's script rides in the diff bundle");
  const chunk = Object.entries(bundle.metafile.outputs).find(
    ([, output]) => script in output.inputs,
  );
  assert.ok(chunk !== undefined, "the worker's script is in no chunk");
  assert.ok(
    entry.imports.some((each) => each.path === chunk[0] && each.kind === "dynamic-import"),
    "the diff bundle imports the worker's chunk other than on demand",
  );
});
