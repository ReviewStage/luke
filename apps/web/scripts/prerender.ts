import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Fills each prerendered page's `<div id="root">` with the markup its React
 * page renders to, so the site's words are in the HTML Vite ships rather
 * than only ever existing after the bundle runs. Runs after the client and
 * server builds, over the pages `src/entry-server.tsx` names.
 */
const DIST = join(import.meta.dirname, "..", "dist");
const SERVER_ENTRY = pathToFileURL(
  join(import.meta.dirname, "..", "dist-server", "entry-server.js"),
).href;

const ROOT_TAG = '<div id="root"></div>';

// SAFETY: dist-server/entry-server.js is the SSR build of src/entry-server.tsx, written by the
// build step that runs immediately before this script, so its exports are that module's.
const { renderPrerenderedPages } = (await import(
  SERVER_ENTRY
)) as typeof import("../src/entry-server");

for (const { file, markup } of renderPrerenderedPages()) {
  const path = join(DIST, file);
  const html = await readFile(path, "utf8");
  if (!html.includes(ROOT_TAG)) {
    throw new Error(`${file}: expected an empty ${ROOT_TAG} to fill`);
  }
  // A replacer function, because a string replacement would read any `$`
  // sequence in the markup as a back-reference into the match.
  await writeFile(
    path,
    html.replace(ROOT_TAG, () => `<div id="root">${markup}</div>`),
  );
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(`prerendered ${file} (${markup.length} chars)`);
}
