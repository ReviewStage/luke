import { readFile, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { AGENT_IMAGE_FILE } from "@repo/service/agents/coder-host/agent-image";
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
import { agentImageReference } from "./agent-image.js";

const WEB = join(import.meta.dirname, "..");

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
const SITE_DIRECTORY = "dist";

const agentImage = Buffer.from(`${await agentImageReference()}\n`, "utf8");

const task = await functionBundlePlan(WEB);
await rm(join(WEB, FUNCTION_BUNDLE_DIRECTORY), { recursive: true, force: true });
const result = await build({ ...task.options, metafile: true, write: true });

const undeclared = undeclaredImports(result.metafile, WEB, task.externalPackages);
if (undeclared.length > 0) {
  throw new Error(
    `bundled routes reach dependencies apps/web does not declare: ${undeclared.join(", ")}`,
  );
}

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
        files: shipsImage.has(join(WEB, bundlePath(definition)))
          ? [{ name: AGENT_IMAGE_FILE, contents: agentImage }]
          : [],
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
