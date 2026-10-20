/**
 * build.test.ts -- eve's compile-time bundle of an authored file, without the inline source map the eve patch drops, and bundled once while its files stand.
 */

import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { temporaryDirectory } from "@luke/wire/testing";
import { expect, test } from "vitest";
import { bundleAuthoredModuleCode } from "../../../node_modules/eve/dist/src/internal/authored-module-loader.js";

/**
 * eve compiles each authored file of an agent into a bundle of its own and
 * imports it in the build process, which keeps every one. The patch in
 * `patches/eve@0.74.0.patch` writes those bundles without the inline source
 * map that was most of each, and that held the coding agent's build past
 * Vercel's 8 GB machine; this fails if an eve bump drops the patch.
 */
test("an authored file's compile-time bundle carries its code and no inline source map", async (t) => {
  const root = await temporaryDirectory(t, "agent-build-");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "authored", type: "module" }));
  writeFileSync(join(root, "words.ts"), 'export const WORDS: string = "compiled words";\n');
  writeFileSync(
    join(root, "tool.ts"),
    'import { WORDS } from "./words.js";\n\nexport default { WORDS };\n',
  );

  const code = await bundleAuthoredModuleCode(join(root, "tool.ts"));

  expect(code).toContain("compiled words");
  expect(code).not.toContain("sourceMappingURL");
});

/**
 * eve's build bundles each authored file once to discover it and again to
 * compile it, in one process, and for the coding agent each bundle carries
 * the whole host: half its build was bundling it a second time. The patch
 * answers a bundle asked for again from the first, while every file in it
 * stands as it did (`statSync`'s size and modification time), and bundles
 * anew once one changes, as `eve dev` does after an edit. That the second
 * answer is the first shows here as a change its stamps cannot see.
 */
test("an authored file bundled again is answered from its first bundle until a file in it changes", async (t) => {
  const root = await temporaryDirectory(t, "agent-build-");
  const words = join(root, "words.ts");
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "authored", type: "module" }));
  writeFileSync(words, 'export const WORDS: string = "first words";\n');
  writeFileSync(
    join(root, "tool.ts"),
    'import { WORDS } from "./words.js";\n\nexport default { WORDS };\n',
  );
  // Note that the stamp is a whole second, because a `Date` handed back to `utimesSync` drops the fraction of a millisecond `statSync` reads.
  const stamp = new Date(1_800_000_000_000);
  utimesSync(words, stamp, stamp);

  const first = await bundleAuthoredModuleCode(join(root, "tool.ts"));
  writeFileSync(words, 'export const WORDS: string = "other words";\n');
  utimesSync(words, stamp, stamp);
  const unseen = await bundleAuthoredModuleCode(join(root, "tool.ts"));
  writeFileSync(words, 'export const WORDS: string = "changed words";\n');
  utimesSync(words, stamp, new Date(stamp.getTime() + 1_000));
  const changed = await bundleAuthoredModuleCode(join(root, "tool.ts"));

  expect(first).toContain("first words");
  expect(unseen).toBe(first);
  expect(changed).toContain("changed words");
});
