import { build } from "esbuild";
import { expect, test } from "vitest";
import { MAIN_ENTRY, NODE_BUNDLE, PRELOAD_ENTRY } from "./node-bundles.mjs";

/** The bundle's import graph, as esbuild resolved it: each input file and the imports it makes. */
async function importGraph(entry) {
  const result = await build({
    ...NODE_BUNDLE,
    entryPoints: [entry],
    outfile: "bundle.js",
    write: false,
    metafile: true,
    logLevel: "silent",
  });
  return result.metafile.inputs;
}

// The preload is evaluated before every window's page, so what it reaches
// is paid on each window's way to its first paint; `effect` alone was most of
// its megabyte, reached through Schema modules for three channel names and
// the bridge's guards.
test("the preload's bundle reaches no module of effect", async () => {
  const inputs = Object.keys(await importGraph(PRELOAD_ENTRY));
  expect(inputs.filter((input) => input.includes("node_modules/effect/"))).toEqual([]);
});

// Main's bundle is evaluated whole before the app is ready, and only a
// signed, packaged run makes an updater engine; electron-updater is
// evaluated only when one does.
test("main reaches electron-updater only through a dynamic import", async () => {
  const inputs = await importGraph(MAIN_ENTRY);
  const updaterImports = Object.values(inputs).flatMap((input) =>
    input.imports.filter((imported) => imported.original === "electron-updater"),
  );
  expect(updaterImports.length).toBeGreaterThan(0);
  expect(updaterImports.map((imported) => imported.kind)).toEqual(
    updaterImports.map(() => "dynamic-import"),
  );
});
