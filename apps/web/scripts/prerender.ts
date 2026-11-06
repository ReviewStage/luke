import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { withPageHead } from "../src/page-head";

const DIST = join(import.meta.dirname, "..", "dist");
const SERVER_ENTRY = pathToFileURL(
  join(import.meta.dirname, "..", "dist-server", "entry-server.js"),
).href;

const ROOT_TAG = '<div id="root"></div>';

const { renderChangelogFeed, renderPrerenderedPages, renderSitemap } = (await import(
  SERVER_ENTRY
)) as typeof import("../src/entry-server");

async function pngSize(path: string): Promise<{ width: number; height: number } | undefined> {
  const bytes = await readFile(path).catch(() => undefined);
  if (bytes === undefined || bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR")
    return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

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

const sitemap = renderSitemap();
await writeFile(join(DIST, sitemap.file), sitemap.xml);
// biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
console.log(`wrote ${sitemap.file} (${sitemap.xml.length} chars)`);
