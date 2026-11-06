import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { expect, test } from "vitest";
import { tailwindPlugin } from "./tailwind.mjs";

const ENTRY = fileURLToPath(new URL("../src/renderer/styles/tailwind.css", import.meta.url));

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
