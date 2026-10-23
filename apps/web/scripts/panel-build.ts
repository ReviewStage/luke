/**
 * panel-build.ts -- the panel's build table (`@luke/panel/build-table`) in Vite's shape: the redirects, the trim, the defines, and the static files under `/app/`.
 *
 * The desktop wraps the same table in esbuild's plugins (`apps/desktop/scripts/build.mjs`),
 * so the two builds answer the panel's imports alike and neither restates
 * why. What only esbuild needs, linking a split chunk's stylesheet by hand,
 * Vite does itself.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  EXCALIDRAW_SCRIPT,
  EXCALIDRAW_STYLESHEET,
  EXCALIDRAW_UNUSED_MODULE,
  excalidrawFontsLocal,
  excalidrawLeftOut,
  excalidrawWithoutFontFallback,
  HIGHLIGHT_WORKER_BUILD,
  HIGHLIGHT_WORKER_SCRIPT,
  highlightWorkerScriptModule,
  LUCIDE_WHOLE,
  lucideWholeModule,
  panelDefines,
  panelStaticDirectories,
  redirectOf,
} from "@luke/panel/build-table";
import { build } from "esbuild";
import type { Plugin } from "vite";
import { PANEL_ASSET_BASE } from "../src/app/web-address";

// Rollup's names for the modules this answers itself, `\0`-led so no other plugin loads them.
const EXCALIDRAW_UNUSED_ID = "\0excalidraw-unused";
const LUCIDE_WHOLE_ID = "\0lucide-whole";

// What each kind of static file is served as in development.
const CONTENT_TYPES = new Map([
  [".woff2", "font/woff2"],
  [".png", "image/png"],
  [".m4a", "audio/mp4"],
]);

// A dynamic `import("lucide-react")`, as the icon picker spells it. Note that
// Rollup's resolver is never told whether an import is dynamic, so the call
// itself is rewritten to name the module of Lucide's `icons` alone.
const LUCIDE_DYNAMIC_IMPORT = /\bimport\(\s*["']lucide-react["']\s*\)/;

/** Every file under a directory, as its path relative to that directory. */
async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)));
}

/**
 * The panel's imports as its build table answers them: Streamdown's HTML
 * parser and Pierre's diff writer redirected to the panel's own modules, the
 * parts of Excalidraw the board never uses left out, its fonts named at
 * their copies under `/app/` alone, and the icon picker's
 * whole Lucide read from one file. Vitest runs this alone, so a test draws
 * what the build ships.
 */
export function panelResolve(): Plugin {
  return {
    name: "panel-resolve",
    enforce: "pre",
    // Note that the stylesheet is an alias rather than a resolution here,
    // because Tailwind resolves a stylesheet's imports through Vite's
    // aliases and never through a plugin.
    // Note too that development serves Excalidraw prebundled by esbuild,
    // which no Vite transform reaches, so the prebundle takes the fonts'
    // fix in esbuild's shape.
    config: () => ({
      resolve: {
        alias: [
          { find: /^@excalidraw\/excalidraw\/index\.css$/, replacement: EXCALIDRAW_STYLESHEET },
        ],
      },
      optimizeDeps: { esbuildOptions: { plugins: [excalidrawFontsLocal] } },
    }),
    resolveId(source, importer) {
      if (source === LUCIDE_WHOLE_ID) return LUCIDE_WHOLE_ID;
      const redirect = redirectOf(source, importer);
      if (redirect !== undefined) return redirect;
      return excalidrawLeftOut(source, importer) ? EXCALIDRAW_UNUSED_ID : undefined;
    },
    load(id) {
      if (id === EXCALIDRAW_UNUSED_ID) return EXCALIDRAW_UNUSED_MODULE;
      return id === LUCIDE_WHOLE_ID ? lucideWholeModule(LUCIDE_WHOLE) : undefined;
    },
    transform(code, id) {
      if (EXCALIDRAW_SCRIPT.test(id.split("?")[0] ?? id)) {
        const local = excalidrawWithoutFontFallback(code);
        return local === undefined ? undefined : { code: local, map: null };
      }
      if (id.includes("/node_modules/") || !LUCIDE_DYNAMIC_IMPORT.test(code)) return undefined;
      const whole = new RegExp(LUCIDE_DYNAMIC_IMPORT.source, "g");
      return { code: code.replace(whole, `import("${LUCIDE_WHOLE_ID}")`), map: null };
    },
  };
}

/**
 * The free identifiers the panel reads. Note that `process.env.NODE_ENV` is
 * left to Vite, which sets it by mode.
 */
function panelDefine(): Plugin {
  return {
    name: "panel-define",
    config() {
      const { "process.env.NODE_ENV": _mode, ...define } = panelDefines();
      return { define };
    },
  };
}

/**
 * The diff highlighter's worker, bundled through esbuild as the desktop
 * bundles it, answering the module the diff bundle imports its text from on
 * demand (`HIGHLIGHT_WORKER_SCRIPT`), which Rollup then splits into a chunk
 * of its own.
 */
function panelHighlightWorker(): Plugin {
  let text: Promise<string> | undefined;
  return {
    name: "panel-highlight-worker",
    load(id) {
      if (id.split("?")[0] !== HIGHLIGHT_WORKER_SCRIPT) return undefined;
      text ??= build(HIGHLIGHT_WORKER_BUILD).then((worker) => worker.outputFiles?.[0]?.text ?? "");
      return text.then(highlightWorkerScriptModule);
    },
  };
}

/** The panel's static files under `/app/`: served from where they stand in development, and emitted with the client build. */
function panelStaticFiles(): Plugin {
  const served = panelStaticDirectories().map(({ from, to }) => ({
    from,
    prefix: `${PANEL_ASSET_BASE}${to}/`,
  }));
  let ssr = false;
  return {
    name: "panel-static-files",
    configResolved(config) {
      ssr = Boolean(config.build.ssr);
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = decodeURIComponent((request.url ?? "").split("?")[0] ?? "");
        const found = served.find(({ prefix }) => url.startsWith(prefix));
        if (found === undefined) return next();
        const file = path.join(found.from, url.slice(found.prefix.length));
        // Note that a path climbing out of the folder (`..`) is refused rather than served.
        if (!file.startsWith(found.from + path.sep)) return next();
        readFile(file).then(
          (bytes) => {
            const type = CONTENT_TYPES.get(path.extname(file));
            if (type !== undefined) response.setHeader("content-type", type);
            response.end(bytes);
          },
          () => next(),
        );
      });
    },
    async generateBundle() {
      if (ssr) return;
      for (const { from, prefix } of served) {
        for (const file of await filesUnder(from)) {
          this.emitFile({
            type: "asset",
            fileName: `${prefix.slice(1)}${file.split(path.sep).join("/")}`,
            source: await readFile(path.join(from, file)),
          });
        }
      }
    },
  };
}

/** Everything the web's build needs to bundle the panel. */
export function panelBuild(): Plugin[] {
  return [panelResolve(), panelDefine(), panelHighlightWorker(), panelStaticFiles()];
}
