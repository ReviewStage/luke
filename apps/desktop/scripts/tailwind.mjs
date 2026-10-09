// tailwind.mjs -- the esbuild plugin that compiles the renderer's Tailwind entry into the one stylesheet it ships.
import fs from "node:fs/promises";
import path from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

// The renderer is built by esbuild rather than Vite, so Tailwind's own Vite
// plugin cannot run here; this does the two things it would. The entry's
// `@import "tailwindcss/…"` and `@theme` are compiled by Tailwind's compiler
// over the entry's own directory, and its `@source` directives name every
// file the utilities are gathered from, so the stylesheet carries exactly the
// classes the renderer and the libraries it names use. The entry names its
// sources itself (`source(none)` on the utilities import), because the
// automatic root would be whatever directory the build was started from.
// Note that the filter carries no flag, because esbuild matches it as a Go
// regular expression.
const TAILWIND_ENTRY = /[\\/]tailwind\.css$/;

export function tailwindPlugin() {
  return {
    name: "tailwind",
    setup(build) {
      build.onLoad({ filter: TAILWIND_ENTRY }, async (args) => {
        const base = path.dirname(args.path);
        const watchFiles = [];
        const compiler = await compile(await fs.readFile(args.path, "utf8"), {
          base,
          from: args.path,
          onDependency: (file) => watchFiles.push(file),
        });
        const scanner = new Scanner({ sources: compiler.sources });
        return {
          contents: compiler.build(scanner.scan()),
          loader: "css",
          resolveDir: base,
          watchFiles,
        };
      });
    },
  };
}
