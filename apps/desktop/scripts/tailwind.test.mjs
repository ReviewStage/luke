import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test } from "vitest";
import { tailwindPlugin } from "./tailwind.mjs";

const ENTRY = fileURLToPath(new URL("../src/renderer/styles/tailwind.css", import.meta.url));

// A `@source` whose path no longer resolves is not an error to Tailwind: it
// reads nothing, and the utilities only it spelled drop out of the stylesheet.
// `[counter-reset:line]` is spelled by Streamdown's code block alone, never by
// a module of the renderer's or the panel's, so the stylesheet carries it only
// while Streamdown is read.
test("the renderer's stylesheet carries the utilities Streamdown draws with", async () => {
  const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    write: false,
    logLevel: "silent",
    plugins: [tailwindPlugin()],
  });
  const css = result.outputFiles.map((file) => file.text).join("\n");
  expect(css).toContain(".\\[counter-reset\\:line\\]");
});
