import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer, type Plugin } from "vite";

type SiteMarkdown = typeof import("../src/site-markdown");

const resolveFile = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const DRAWING_MODULE = resolveFile("../src/site-markdown.tsx");

interface SiteDocument {
  readonly file: string;
  readonly draw: (site: SiteMarkdown, words: string) => unknown;
}

const SITE_DOCUMENTS = new Map<string, SiteDocument>([
  [
    "virtual:site/changelog-releases",
    {
      file: resolveFile("../../../CHANGELOG.md"),
      draw: (site, words) => site.parseReleases(words),
    },
  ],
  [
    "virtual:site/privacy-policy",
    { file: resolveFile("../../../PRIVACY.md"), draw: (site, words) => site.policyOf(words) },
  ],
]);

const RESOLVED_PREFIX = "\0";

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
    const site = (await server.ssrLoadModule(DRAWING_MODULE)) as SiteMarkdown;
    return draw(site);
  } finally {
    await server.close();
  }
}

async function drawnDocument(document: SiteDocument): Promise<unknown> {
  const words = await readFile(document.file, "utf8");
  return drawnBySite((site) => document.draw(site, words));
}

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

export function siteMarkdown(): Plugin {
  let building = false;
  let drawings: Map<string, unknown> | undefined;
  return {
    name: "site-markdown",
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
