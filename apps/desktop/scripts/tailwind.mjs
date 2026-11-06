import fs from "node:fs/promises";
import path from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

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
