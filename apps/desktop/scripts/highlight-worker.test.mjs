// highlight-worker.test.mjs -- the diff highlighter's worker, which rides in the diff bundle as text, carries no grammar or theme set of its own.

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { HIGHLIGHT_WORKER_BUILD } from "@luke/panel/build-table";
import { build } from "esbuild";
import { test } from "vitest";

/**
 * Pierre's worker is handed every grammar and theme it highlights with by
 * the window's thread, yet bundled as written it carried all of Shiki's
 * grammars and every theme catalogue, 10.5 MB, as text inside the diff
 * bundle, which the window parsed the first time a diff was drawn. This
 * bundles the worker as the build table says and reads what it was made of.
 */

const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));

// The sets the worker never loads: Shiki's grammars and themes, Highlights' themes, and Pierre's own.
const SETS =
  /node_modules\/@shikijs\/(?:langs|themes)\/|node_modules\/@pierre\/theme\/|node_modules\/@pierre\/highlights\/dist\/themes\//;

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
