/**
 * site-markdown.ts -- the site's Markdown documents answered as modules of finished HTML: CHANGELOG.md's releases and PRIVACY.md's policy, drawn by `src/site-markdown.tsx` when the site is built or served.
 *
 * A page imports `virtual:luke/changelog-releases` or
 * `virtual:luke/privacy-policy` and is handed values, every release's and
 * section's HTML among them, so the renderer (`@luke/ui/markdown`) runs in
 * the build and never in a visitor's tab. The drawing module is TypeScript
 * that reaches the shared packages' sources, so it is loaded through a Vite
 * server of its own for the one load, which runs it as the SSR build runs
 * the pages, and closed after. Each document is watched, so an edit to it
 * reloads its page under `vite`.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";

/** What `src/site-markdown.tsx` answers, as this plugin reads it. */
type SiteMarkdown = typeof import("../src/site-markdown");

const resolveFile = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const DRAWING_MODULE = resolveFile("../src/site-markdown.tsx");

/** Each module this answers, the document it is read from, and how that document is drawn. */
const SITE_DOCUMENTS = new Map<
  string,
  { file: string; draw: (site: SiteMarkdown, words: string) => unknown }
>([
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

/** The plugin that answers each site document's module with its drawn values. */
export function siteMarkdown(): Plugin {
  return {
    name: "luke-site-markdown",
    resolveId: (id) => (SITE_DOCUMENTS.has(id) ? `${RESOLVED_PREFIX}${id}` : undefined),
    async load(id) {
      const document = id.startsWith(RESOLVED_PREFIX)
        ? SITE_DOCUMENTS.get(id.slice(RESOLVED_PREFIX.length))
        : undefined;
      if (document === undefined) return undefined;
      this.addWatchFile(document.file);
      const words = await readFile(document.file, "utf8");
      const value = await drawnBySite((site) => document.draw(site, words));
      return `export default ${JSON.stringify(value)};`;
    },
  };
}
