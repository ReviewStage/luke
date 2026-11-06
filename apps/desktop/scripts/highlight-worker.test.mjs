import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { HIGHLIGHT_WORKER_BUILD } from "@repo/panel/build-table";
import { build } from "esbuild";
import { test } from "vitest";

const REPOSITORY = fileURLToPath(new URL("../../..", import.meta.url));

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
