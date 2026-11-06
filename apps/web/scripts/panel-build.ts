import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  HIGHLIGHT_WORKER_BUILD,
  LUCIDE_WHOLE,
  lucideWholeModule,
  panelDefines,
  panelStaticDirectories,
  redirectOf,
} from "@repo/panel/build-table";
import { build } from "esbuild";
import type { Plugin } from "vite";
import { PANEL_ASSET_BASE } from "../src/app/web-address";

const LUCIDE_WHOLE_ID = "\0lucide-whole";

const CONTENT_TYPES = new Map([[".png", "image/png"]]);

const LUCIDE_DYNAMIC_IMPORT = /\bimport\(\s*["']lucide-react["']\s*\)/;

async function filesUnder(directory: string): Promise<readonly string[]> {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)));
}

export function panelResolve(): Plugin {
  return {
    name: "panel-resolve",
    enforce: "pre",
    resolveId(source, importer) {
      if (source === LUCIDE_WHOLE_ID) return LUCIDE_WHOLE_ID;
      return redirectOf(source, importer);
    },
    load(id) {
      return id === LUCIDE_WHOLE_ID ? lucideWholeModule(LUCIDE_WHOLE) : undefined;
    },
    transform(code, id) {
      if (id.includes("/node_modules/") || !LUCIDE_DYNAMIC_IMPORT.test(code)) return undefined;
      const whole = new RegExp(LUCIDE_DYNAMIC_IMPORT.source, "g");
      return { code: code.replace(whole, `import("${LUCIDE_WHOLE_ID}")`), map: null };
    },
  };
}

function panelDefine(): Plugin {
  return {
    name: "panel-define",
    async config() {
      const worker = await build(HIGHLIGHT_WORKER_BUILD);
      const { "process.env.NODE_ENV": _mode, ...define } = panelDefines(
        worker.outputFiles?.[0]?.text ?? "",
      );
      return { define };
    },
  };
}

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

export function panelBuild(): Plugin[] {
  return [panelResolve(), panelDefine(), panelStaticFiles()];
}
