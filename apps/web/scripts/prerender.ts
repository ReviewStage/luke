import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Fills each prerendered page's `<div id="root">` with the markup its React
 * page renders to, so the site's words are in the HTML Vite ships rather
 * than only ever existing after the bundle runs. Runs after the client and
 * server builds; the pages it touches are the ones `src/entry-server.tsx`
 * names, and the two lists are the same list read from two ends.
 */
const DIST = join(import.meta.dirname, "..", "dist");
const SERVER_ENTRY = pathToFileURL(
  join(import.meta.dirname, "..", "dist-server", "entry-server.js"),
).href;

const ROOT_TAG = '<div id="root"></div>';

const { renderPage } = (await import(SERVER_ENTRY)) as typeof import("../src/entry-server");

const pages = [
  "index.html",
  "about.html",
  "changelog.html",
  "docs.html",
  "pricing.html",
  "privacy.html",
];

for (const page of pages) {
  const file = join(DIST, page);
  const html = await readFile(file, "utf8");
  if (!html.includes(ROOT_TAG)) {
    throw new Error(`${page}: expected an empty ${ROOT_TAG} to fill`);
  }
  const markup = renderPage(page);
  await writeFile(file, html.replace(ROOT_TAG, `<div id="root">${markup}</div>`));
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(`prerendered ${page} (${markup.length} chars)`);
}
