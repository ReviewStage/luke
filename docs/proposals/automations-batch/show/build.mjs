// build.mjs -- bundles the show's scenes against one tree (main, or the prototype worktree) with that tree's own compiled CSS, light and dark.
//
// Usage: node build.mjs <variant> <repoRoot>
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [variant, root] = process.argv.slice(2);
const desktop = path.join(root, "apps/desktop");
const out = path.join(here, "out", variant);
const { build } = await import(path.join(desktop, "node_modules/esbuild/lib/main.js"));

await fs.mkdir(out, { recursive: true });

// The tree's own stylesheet, as its build compiles it (tailwind included).
if (process.env.SKIP_CSS !== "1") {
  execFileSync("node", ["scripts/build.mjs"], { cwd: desktop, stdio: "ignore" });
  const css = await fs.readFile(path.join(desktop, "dist/renderer/styles.css"), "utf8");
  // Note that the app follows the system's appearance by media query, so each theme is that query forced one way.
  const light = css.replace(/prefers-color-scheme:\s*light/g, "min-width:0px").replace(/prefers-color-scheme:\s*dark/g, "max-width:0px");
  const dark = css.replace(/prefers-color-scheme:\s*light/g, "max-width:0px").replace(/prefers-color-scheme:\s*dark/g, "min-width:0px");
  await fs.writeFile(path.join(out, "styles-light.css"), light);
  await fs.writeFile(path.join(out, "styles-dark.css"), dark);
  await fs.cp(path.join(desktop, "dist/renderer/fonts"), path.join(out, "fonts"), { recursive: true });
}

await build({
  entryPoints: { scenes: path.join(here, "scenes.tsx") },
  outdir: out,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "chrome140",
  jsx: "automatic",
  minify: false,
  sourcemap: false,
  logLevel: "warning",
  nodePaths: [path.join(desktop, "node_modules"), path.join(root, "node_modules")],
  alias: {
    "@renderer": path.join(desktop, "src/renderer"),
    "@testing": path.join(desktop, "src/testing"),
    "@shared": path.join(desktop, "src/shared"),
  },
  define: {
    "process.env.NODE_ENV": '"development"',
    PACKAGED_POSTHOG_PROJECT_API_KEY: '""',
    SHOW_VARIANT: JSON.stringify(variant),
  },
  loader: { ".woff2": "file", ".png": "file", ".svg": "file" },
});
console.log(`built ${variant} from ${root}`);
