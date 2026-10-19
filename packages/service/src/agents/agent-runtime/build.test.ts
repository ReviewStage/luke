import { writeFileSync } from "node:fs";
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
