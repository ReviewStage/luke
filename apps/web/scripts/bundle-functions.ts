import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { sentryEsbuildPlugin } from "@sentry/esbuild-plugin";
import { type BuildOptions, build } from "esbuild";
import {
  BUILD_OUTPUT_DIRECTORY,
  emitBuildOutput,
  HAND_WRITTEN_FUNCTIONS,
} from "../server/build-output.js";
import {
  expectedExternals,
  externalsByBundle,
  externalsDrift,
  FUNCTION_METAFILE,
  functionBundlePlan,
  importChain,
  undeclaredImports,
} from "../server/function-bundles.js";
import {
  bundlePath,
  FUNCTION_BUNDLE_DIRECTORY,
  functionPublicPath,
} from "../server/function-layout.js";

/**
 * Bundles the functions the routes under `server/routes/` are grouped into,
 * each a plain ESM file under `dist-functions/`, so Vercel's builder finds JavaScript
 * and only traces dependencies. Handed TypeScript, the builder runs its own
 * compiler over each function's whole import graph separately — thirty-odd
 * passes over the same sixteen workspace packages, most of a deploy's build
 * time, under compiler options that are not this repository's.
 *
 * Each bundle is emitted whole into a `.func` of the Build Output tree
 * (`server/build-output.ts`), which is what Vercel deploys; nothing under
 * `api/` is committed, so Vercel's zero-config pass has nothing to build
 * beside it.
 *
 * Workspace packages and declared dependencies alike are inlined, since a
 * `.func` carries only what is under it. Anything that still resolved
 * external and is neither a Node builtin nor a named exception is a module
 * the function would fail to load, so the build refuses it here instead.
 */
const WEB = join(import.meta.dirname, "..");
/** Where `vite build` and `prerender.ts` leave the site, copied whole under the output's `static/`. */
const SITE_DIRECTORY = "dist";

/**
 * The bundles' source maps, uploaded to Sentry's `luke-web` project as its
 * esbuild guide sets it up, so a function's stack trace reads as the source.
 * The maps are written beside the bundles, uploaded, and deleted before the output is
 * emitted, so none ships in a function. Only a production build that holds
 * `SENTRY_AUTH_TOKEN` uploads; any other, a Preview's included, bundles as
 * before, since a Preview's traces are rarely read and the maps cost its build. The plugin names
 * the release from the deployment's commit and writes it into each bundle,
 * which is the release the SDK then reports under.
 */
function withSentrySourceMaps(options: BuildOptions): BuildOptions {
  const authToken = process.env.SENTRY_AUTH_TOKEN;
  if (!authToken || process.env.VERCEL_ENV !== "production") return options;
  return {
    ...options,
    // Sentry's guide asks for "hidden" maps; esbuild spells that `external`,
    // a map written beside the bundle and named by no comment in it.
    sourcemap: "external",
    plugins: [
      ...(options.plugins ?? []),
      // Sentry's plugin goes after all others.
      sentryEsbuildPlugin({
        org: "stage-review",
        project: "luke-web",
        authToken,
        sourcemaps: {
          filesToDeleteAfterUpload: [join(WEB, FUNCTION_BUNDLE_DIRECTORY, "**/*.map")],
        },
      }),
    ],
  };
}

const task = await functionBundlePlan(WEB);
// Emptied first, so a bundle an earlier plan emitted can never sit beside the shipping ones and be read as one of them.
await rm(join(WEB, FUNCTION_BUNDLE_DIRECTORY), { recursive: true, force: true });
const result = await build({ ...withSentrySourceMaps(task.options), metafile: true, write: true });

const undeclared = undeclaredImports(result.metafile, WEB, task.externalPackages);
if (undeclared.length > 0) {
  throw new Error(
    `bundled routes reach dependencies apps/web does not declare: ${undeclared.join(", ")}`,
  );
}

await writeFile(join(WEB, FUNCTION_METAFILE), JSON.stringify(result.metafile));

const externals = externalsDrift(
  await expectedExternals(WEB),
  externalsByBundle(result.metafile, WEB),
);
if (externals.length > 0) {
  const lines = externals.map((entry) => {
    const outputPath = Object.keys(result.metafile.outputs).find((path) =>
      path.endsWith(entry.bundle),
    );
    const chains = entry.added.map(
      (added) =>
        `${added} via ${(outputPath === undefined ? [] : importChain(result.metafile, outputPath, added)).join(" -> ")}`,
    );
    return `${entry.bundle}: added ${JSON.stringify(entry.added)} removed ${JSON.stringify(entry.removed)}${chains.length > 0 ? ` (${chains.join("; ")})` : ""}`;
  });
  throw new Error(
    `function bundles load externals the record does not expect (run \`pnpm --filter @luke/web functions:externals\` if intended):\n${lines.join("\n")}`,
  );
}

const durationOf = new Map(
  task.functions.map((definition) => [join(WEB, bundlePath(definition)), definition.maxDuration]),
);
for (const [file, output] of Object.entries(result.metafile.outputs)) {
  const maxDuration = durationOf.get(join(WEB, file));
  // biome-ignore lint/suspicious/noConsole: a build script's output is its log — what it wrote, and how much of it.
  console.log(
    `bundled ${relative(WEB, file)} (${output.bytes} bytes${maxDuration === undefined ? "" : `, ${maxDuration}s`})`,
  );
}

const emitted = await emitBuildOutput({
  outputDirectory: join(WEB, BUILD_OUTPUT_DIRECTORY),
  staticDirectory: join(WEB, SITE_DIRECTORY),
  functions: [
    ...(await Promise.all(
      task.functions.map(async (definition) => ({
        path: functionPublicPath(definition),
        contents: await readFile(join(WEB, bundlePath(definition))),
        maxDuration: definition.maxDuration,
      })),
    )),
    ...(await Promise.all(
      HAND_WRITTEN_FUNCTIONS.map(async (fn) => ({
        path: fn.path,
        contents: await readFile(join(WEB, fn.source)),
        maxDuration: undefined,
      })),
    )),
  ],
});
// biome-ignore lint/suspicious/noConsole: a build script's output is its log — the tree it left for Vercel.
console.log(
  `emitted ${BUILD_OUTPUT_DIRECTORY} with ${emitted.length} functions: ${emitted.join(", ")}`,
);
