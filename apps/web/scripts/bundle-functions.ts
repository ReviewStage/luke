import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { build } from "esbuild";
import {
  BUILD_OUTPUT_DIRECTORY,
  emitBuildOutput,
  HAND_WRITTEN_FUNCTIONS,
} from "../server/build-output.js";
import {
  bundlesReaching,
  FUNCTION_METAFILE,
  functionBundlePlan,
  localOnlyReach,
  undeclaredImports,
} from "../server/function-bundles.js";
import {
  bundlePath,
  FUNCTION_BUNDLE_DIRECTORY,
  functionPublicPath,
} from "../server/function-layout.js";
import { agentImageContext, shippedBesideFunctions } from "./agent-image.js";

/**
 * Bundles the functions the routes under `server/routes/` and the hosted
 * oRPC route are grouped into,
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

/**
 * The module that reads the agents' image reference beside a function's
 * entry. Every function whose bundle reaches it ships the reference, the
 * image's digest without the runner, and the runner's bundle in its
 * `.func`, the reference computed here as CI computes the tag it pushes the image under
 * (`agent-image.ts`), and a build without the runner's bundle the image
 * carries fails here rather than deploy a launch that names no image.
 */
const AGENT_IMAGE_READER = join(
  WEB,
  "..",
  "..",
  "packages",
  "service",
  "src",
  "agents",
  "coder-host",
  "agent-image.ts",
);
/** Where `vite build` and `prerender.ts` leave the site, copied whole under the output's `static/`. */
const SITE_DIRECTORY = "dist";

const agentImage = shippedBesideFunctions(await agentImageContext());

const task = await functionBundlePlan(WEB);
// Emptied first, so a bundle an earlier plan emitted can never sit beside the shipping ones and be read as one of them.
await rm(join(WEB, FUNCTION_BUNDLE_DIRECTORY), { recursive: true, force: true });
const result = await build({ ...task.options, metafile: true, write: true });

const undeclared = undeclaredImports(result.metafile, WEB, task.externalPackages);
if (undeclared.length > 0) {
  throw new Error(
    `bundled routes reach dependencies apps/web does not declare: ${undeclared.join(", ")}`,
  );
}

// A route that reaches the local server's own routes would carry a session for anyone into the deploy.
const localOnly = localOnlyReach(result.metafile, WEB);
if (localOnly.length > 0) {
  throw new Error(
    `bundled routes reach modules only the local server may carry: ${localOnly.join(", ")}`,
  );
}

await writeFile(join(WEB, FUNCTION_METAFILE), JSON.stringify(result.metafile));

const shipsImage = new Set(
  [...bundlesReaching(result.metafile, WEB, AGENT_IMAGE_READER)].map((path) => join(WEB, path)),
);

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
        queueTopic: definition.queueTopic,
        files: shipsImage.has(join(WEB, bundlePath(definition))) ? agentImage : [],
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
