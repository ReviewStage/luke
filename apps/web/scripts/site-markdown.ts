/**
 * site-markdown.ts -- the site's Markdown documents answered as modules of finished HTML: CHANGELOG.md's releases and PRIVACY.md's policy, drawn by `src/site-markdown.tsx` when the site is built or served.
 *
 * A page imports `virtual:luke/changelog-releases` or
 * `virtual:luke/privacy-policy` and is handed values, every release's and
 * section's HTML among them, so the renderer (`@luke/ui/markdown`) runs in
 * the build and never in a visitor's tab. The drawing module is TypeScript
 * that reaches the shared packages' sources, so it is loaded through a Vite
 * server of its own, which runs it as the SSR build runs the pages, and
 * closed after: a build draws every document through one such server at
 * its start, before Rollup transforms a module, and `vite` draws each when
 * its module loads. Each document is watched, so an edit to it reloads its
 * page under `vite`.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";

/** What `src/site-markdown.tsx` answers, as this plugin reads it. */
type SiteMarkdown = typeof import("../src/site-markdown");

const resolveFile = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const DRAWING_MODULE = resolveFile("../src/site-markdown.tsx");

/** A document this answers: the file it is read from, and how it is drawn. */
interface SiteDocument {
  readonly file: string;
  readonly draw: (site: SiteMarkdown, words: string) => unknown;
}

/** Each module this answers, and its document. */
const SITE_DOCUMENTS = new Map<string, SiteDocument>([
  [
    "virtual:luke/changelog-releases",
    {
      file: resolveFile("../../../CHANGELOG.md"),
      draw: (site, words) => site.parseReleases(words),
    },
  ],
  [
    "virtual:luke/privacy-policy",
    { file: resolveFile("../../../PRIVACY.md"), draw: (site, words) => site.policyOf(words) },
  ],
]);

/** Rollup's name for a module this answers, `\0`-led so no other plugin loads it. */
const RESOLVED_PREFIX = "\0";

/**
 * What the drawing module answers, run once through a Vite server of its own
 * that is closed once it has answered: the build's own way of running it,
 * which a test of the documents runs too. Note that the server reads no
 * config, so the panel's redirects (`panel-build.ts`), which answer the HTML
 * parser with a loader that draws HTML as text until it lands, never reach
 * the documents.
 */
export async function drawnBySite<Drawn>(draw: (site: SiteMarkdown) => Drawn): Promise<Drawn> {
  const server = await createServer({
    configFile: false,
    root: resolveFile(".."),
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: "automatic" },
  });
  try {
    // SAFETY: the module is `src/site-markdown.tsx`, whose exports this file's type names.
    const site = (await server.ssrLoadModule(DRAWING_MODULE)) as SiteMarkdown;
    return draw(site);
  } finally {
    await server.close();
  }
}

/** One site document drawn through a server of its own. */
async function drawnDocument(document: SiteDocument): Promise<unknown> {
  const words = await readFile(document.file, "utf8");
  return drawnBySite((site) => document.draw(site, words));
}

/** Every site document drawn through one server, by the module that answers it. */
async function drawnDocuments(): Promise<Map<string, unknown>> {
  const documents = await Promise.all(
    [...SITE_DOCUMENTS].map(async ([id, document]) => ({
      id,
      document,
      words: await readFile(document.file, "utf8"),
    })),
  );
  return drawnBySite(
    (site) => new Map(documents.map(({ id, document, words }) => [id, document.draw(site, words)])),
  );
}

/**
 * The plugin that answers each site document's module with its drawn values.
 * Note that a build draws every document in `buildStart`, because the server
 * runs on the build's own event loop: drawn beside Rollup's transforms, each
 * module the server fetches waits behind theirs, past the module runner's
 * fixed 60 s on a loaded machine. Served (`vite`, vitest), nothing transforms
 * beside it, so each document is drawn alone when its module loads, and one
 * that fails to draw fails only its own page.
 */
export function siteMarkdown(): Plugin {
  let building = false;
  let drawings: Map<string, unknown> | undefined;
  return {
    name: "luke-site-markdown",
    configResolved(config) {
      building = config.command === "build";
    },
    async buildStart() {
      if (building) drawings = await drawnDocuments();
    },
    resolveId: (id) => (SITE_DOCUMENTS.has(id) ? `${RESOLVED_PREFIX}${id}` : undefined),
    async load(id) {
      const name = id.startsWith(RESOLVED_PREFIX) ? id.slice(RESOLVED_PREFIX.length) : undefined;
      const document = name === undefined ? undefined : SITE_DOCUMENTS.get(name);
      if (name === undefined || document === undefined) return undefined;
      this.addWatchFile(document.file);
      const value = drawings?.has(name) ? drawings.get(name) : await drawnDocument(document);
      return `export default ${JSON.stringify(value)};`;
    },
  };
}
