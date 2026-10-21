// font-addresses.test.ts -- the whiteboard's fonts are named at the panel's own copies alone, and every one the board draws in is a copy the build serves.

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXCALIDRAW_SCRIPT,
  excalidrawWithoutFontFallback,
  panelStaticDirectories,
} from "@luke/panel/build-table";
import { test } from "vitest";

/**
 * Excalidraw names each font face at its copy under the asset base and again
 * on esm.sh, and Chromium checks both against the panel's `font-src 'self'`
 * as the face is made, so every face of a board was refused and reported
 * once it opened. Both builds take the esm.sh address out through the build
 * table, so these read Excalidraw's scripts as installed, in both of the
 * builds its package ships (the web's development server resolves `dev`,
 * every bundle `prod`), and fail on an upgrade that moves the address.
 */

const EXCALIDRAW_DIST = path.dirname(
  path.dirname(fileURLToPath(import.meta.resolve("@excalidraw/excalidraw"))),
);

/** Every script of one of Excalidraw's builds, as its path and its text. */
function scriptsOf(build: string): readonly { readonly file: string; readonly code: string }[] {
  const directory = path.join(EXCALIDRAW_DIST, build);
  return readdirSync(directory)
    .map((name) => path.join(directory, name))
    .filter((file) => EXCALIDRAW_SCRIPT.test(file))
    .map((file) => ({ file, code: readFileSync(file, "utf8") }));
}

// The font Excalidraw draws Chinese, Japanese, and Korean text in, some two hundred files the build leaves out.
const LEFT_OUT_FONT = "Xiaolai/";

test("no font face of Excalidraw's names an address off the panel's origin once the build has read it", () => {
  for (const build of ["prod", "dev"]) {
    const read = scriptsOf(build).map(({ code }) => excalidrawWithoutFontFallback(code) ?? code);
    assert.ok(
      read.some((code) => code.includes("ASSETS_FALLBACK_URL")),
      `${build}: Excalidraw names no esm.sh fallback any more, so this test reads nothing`,
    );
    for (const code of read) assert.doesNotMatch(code, /\.ASSETS_FALLBACK_URL\b/);
  }
});

test("a script naming the fallback in a shape the build does not know fails the build", () => {
  assert.throws(() =>
    excalidrawWithoutFontFallback("urls.unshift(new URL(path, Face.ASSETS_FALLBACK_URL));"),
  );
  assert.equal(excalidrawWithoutFontFallback("export const fonts = [];"), undefined);
});

test("every font file Excalidraw names is one the build serves under the asset base", () => {
  const named = new Set<string>();
  for (const { code } of scriptsOf("prod")) {
    for (const [, file] of code.matchAll(/["'`]\.\/fonts\/([^"'`]+\.woff2)["'`]/g)) {
      if (file !== undefined && !file.startsWith(LEFT_OUT_FONT)) named.add(`fonts/${file}`);
    }
  }
  assert.ok(named.size > 0, "Excalidraw names no font files, so this test reads nothing");
  const served = (assetPath: string) =>
    panelStaticDirectories().some(({ from, to }) => {
      if (!assetPath.startsWith(`${to}/`)) return false;
      return (
        statSync(path.join(from, assetPath.slice(to.length + 1)), {
          throwIfNoEntry: false,
        })?.isFile() ?? false
      );
    });
  for (const assetPath of named) assert.ok(served(assetPath), assetPath);
});
