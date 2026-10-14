import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { withPageHead } from "../src/page-head";

/**
 * Fills each prerendered page's `<div id="root">` with the markup its React
 * page renders to, so the site's words are in the HTML Vite ships rather
 * than only ever existing after the bundle runs. Runs after the client and
 * server builds, over the pages `src/entry-server.tsx` names. A page written
 * from another page's template (every changelog page and release, from
 * `changelog.html`) gets its route's own head too, its share image at the
 * size the image's own file says. The changelog's RSS feed is written beside
 * its pages.
 */
const DIST = join(import.meta.dirname, "..", "dist");
const SERVER_ENTRY = pathToFileURL(
  join(import.meta.dirname, "..", "dist-server", "entry-server.js"),
).href;

const ROOT_TAG = '<div id="root"></div>';

// SAFETY: dist-server/entry-server.js is the SSR build of src/entry-server.tsx, written by the
// build step that runs immediately before this script, so its exports are that module's.
const { renderChangelogFeed, renderPrerenderedPages } = (await import(
  SERVER_ENTRY
)) as typeof import("../src/entry-server");

/** A PNG's size, read from its IHDR chunk: width and height are the 4-byte integers at 16 and 20. */
async function pngSize(path: string): Promise<{ width: number; height: number } | undefined> {
  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined || bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR")
    return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/* Each built file as Vite wrote it, read once. Note that we keep the first
   read, because the changelog's first page is written over the very template
   its other pages are written from. */
const sources = new Map<string, string>();
async function builtSource(file: string): Promise<string> {
  const cached = sources.get(file);
  if (cached !== undefined) return cached;
  const source = await readFile(join(DIST, file), "utf8");
  sources.set(file, source);
  return source;
}

for (const { file, template, markup, head } of renderPrerenderedPages()) {
  const path = join(DIST, file);
  const source = await builtSource(template ?? file);
  if (!source.includes(ROOT_TAG)) {
    throw new Error(`${template ?? file}: expected an empty ${ROOT_TAG} to fill`);
  }
  const imageSize =
    head?.image === undefined ? undefined : await pngSize(join(DIST, head.image.src));
  const html = head === undefined ? source : withPageHead(source, head, imageSize);
  await mkdir(dirname(path), { recursive: true });
  // A replacer function, because a string replacement would read any `$`
  // sequence in the markup as a back-reference into the match.
  await writeFile(
    path,
    html.replace(ROOT_TAG, () => `<div id="root">${markup}</div>`),
  );
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(`prerendered ${file} (${markup.length} chars)`);
}

const feed = renderChangelogFeed();
await mkdir(dirname(join(DIST, feed.file)), { recursive: true });
await writeFile(join(DIST, feed.file), feed.xml);
// biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
console.log(`wrote ${feed.file} (${feed.xml.length} chars)`);
