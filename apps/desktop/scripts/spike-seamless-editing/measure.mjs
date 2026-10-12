// measure.mjs -- SPIKE: the renderer bundle's gzipped size with each in-place editor prototype added, and the demo page's build.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

/**
 * SPIKE, not production code. Run from a checkout of `main` with this
 * folder copied in, so the base is `main`'s renderer exactly:
 *
 *   node scripts/spike-seamless-editing/measure.mjs          # the bundle table
 *   node scripts/spike-seamless-editing/measure.mjs demo out/  # the demo page into out/
 *
 * Each variant is the renderer's own entry plus one prototype held live on a
 * global, built with `scripts/build.mjs`'s renderer options and gzipped at
 * level 9, as the budget check measures it.
 */

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const renderer = path.join(appRoot, "src/renderer");
const spike = path.join(renderer, "spike");

const RENDERER_OPTIONS = {
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome140",
  jsx: "automatic",
  minify: true,
  write: false,
  logLevel: "error",
  define: {
    "process.env.NODE_ENV": '"production"',
    PACKAGED_POSTHOG_PROJECT_API_KEY: '""',
  },
};

const VARIANTS = {
  main: "",
  "+ minimal ProseMirror (pm-field)": `import { PmFieldEditor } from "./spike/pm-field"; globalThis.__spike = PmFieldEditor;`,
  "+ TipTap (StarterKit, our mdast bridge)": `import { TipTapFieldEditor } from "./spike/tiptap-field"; globalThis.__spike = TipTapFieldEditor;`,
  "+ TipTap + @tiptap/markdown (marked)": `import { TipTapFieldEditor } from "./spike/tiptap-field"; import { Markdown } from "@tiptap/markdown"; globalThis.__spike = [TipTapFieldEditor, Markdown];`,
  "+ Lexical (rich text, list, link, markdown)": `import { LexicalFieldEditor } from "./spike/lexical-field"; globalThis.__spike = LexicalFieldEditor;`,
  "+ contenteditable (ce-field)": `import { ContentEditableFieldEditor } from "./spike/ce-field"; globalThis.__spike = ContentEditableFieldEditor;`,
};

async function gzipped(extra) {
  const result = await build({
    ...RENDERER_OPTIONS,
    stdin: {
      contents: `import "./index.tsx";\n${extra}`,
      resolveDir: renderer,
      sourcefile: "measure-entry.tsx",
      loader: "tsx",
    },
    outfile: "renderer.js",
  });
  const bytes = result.outputFiles[0].contents;
  return { raw: bytes.length, gz: gzipSync(bytes, { level: 9 }).length };
}

/** Each editor as a bundle of its own, loaded on first use as `whiteboard.js` is: no React, nothing shared with the renderer. */
const LAZY = {
  "minimal ProseMirror (pm-mount, vanilla)": `import { mountFieldEditor } from "./spike/pm-mount"; globalThis.__spike = mountFieldEditor;`,
  "TipTap core + StarterKit (vanilla, our bridge)": `import { Editor } from "@tiptap/core"; import StarterKit from "@tiptap/starter-kit"; import { fieldJson, valueOf } from "./spike/field-value"; globalThis.__spike = [Editor, StarterKit, fieldJson, valueOf];`,
  "Lexical core + rich text, list, link, markdown (vanilla)": `import { createEditor } from "lexical"; import { registerRichText } from "@lexical/rich-text"; import { registerList } from "@lexical/list"; import { LinkNode } from "@lexical/link"; import { registerHistory } from "@lexical/history"; import { $convertFromMarkdownString, registerMarkdownShortcuts, TRANSFORMERS } from "@lexical/markdown"; globalThis.__spike = [createEditor, registerRichText, registerList, LinkNode, registerHistory, $convertFromMarkdownString, registerMarkdownShortcuts, TRANSFORMERS];`,
};

async function lazyGzipped(entry) {
  const result = await build({
    ...RENDERER_OPTIONS,
    stdin: { contents: entry, resolveDir: renderer, sourcefile: "lazy-entry.ts", loader: "ts" },
    outfile: "editor.js",
  });
  const bytes = result.outputFiles[0].contents;
  return { raw: bytes.length, gz: gzipSync(bytes, { level: 9 }).length };
}

async function table() {
  const budget = JSON.parse(await fs.readFile(path.join(appRoot, "bundle-budget.json"), "utf8"));
  const baseline = budget.gzipBytes["renderer/renderer.js"];
  const ceiling = Math.floor(baseline * (1 + budget.slack));
  let main;
  process.stdout.write(`baseline ${baseline}, ceiling ${ceiling}\n`);
  for (const [name, extra] of Object.entries(VARIANTS)) {
    const { raw, gz } = await gzipped(extra);
    main ??= gz;
    const delta = gz - main;
    const verdict = gz > ceiling ? "OVER" : "under";
    process.stdout.write(
      `${name}\t${gz}\t+${delta}\traw ${raw}\t${verdict} by ${Math.abs(ceiling - gz)}\n`,
    );
  }
  process.stdout.write("lazy bundles (not in renderer.js):\n");
  for (const [name, entry] of Object.entries(LAZY)) {
    const { raw, gz } = await lazyGzipped(entry);
    process.stdout.write(`${name}\t${gz}\traw ${raw}\n`);
  }
}

async function demo(out) {
  await fs.mkdir(out, { recursive: true });
  await build({
    ...RENDERER_OPTIONS,
    write: true,
    minify: false,
    entryPoints: [path.join(spike, "demo.tsx")],
    outfile: path.join(out, "demo.js"),
  });
  await fs.copyFile(path.join(appRoot, "dist/renderer/styles.css"), path.join(out, "styles.css"));
  await fs.writeFile(
    path.join(out, "index.html"),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Spike</title>
<link rel="stylesheet" href="styles.css"><style>
html,body,#root{height:100%;margin:0}body{background:var(--desktop-ground,#0c0c0e)}
.spike-demo{max-width:720px;height:100%;margin:0 auto;padding:0 28px}
</style></head><body><div id="root"></div><script src="demo.js"></script></body></html>`,
  );
}

const [mode, out] = process.argv.slice(2);
if (mode === "demo") await demo(path.resolve(out ?? "spike-demo"));
else await table();
